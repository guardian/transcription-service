import { execFile, type ChildProcess } from 'child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import {
	killProcess,
	logger,
	spawnBackgroundProcess,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { LlmPrompt } from '@guardian/transcription-service-common';
import { z } from 'zod';
import { Agent } from 'undici';

export const LOCAL_LLAMA_PARALLEL_JOBS = 2;

export type ServerConfig = {
	modelPath: string;
	executable: string;
	libPath?: string;
	port: string;
	serverUrl: string;
};

export const getServerConfig = (config: TranscriptionConfig): ServerConfig => {
	const port = process.env.LLAMA_SERVER_PORT || '9080';
	return {
		modelPath: config.llamacpp.modelPath,
		executable: 'llama-server',
		libPath:
			config.llamacpp.installDirectory && config.app.stage !== 'DEV'
				? `${config.llamacpp.installDirectory}/lib/`
				: undefined,
		port: port,
		serverUrl: `http://localhost:${port}`,
	};
};

const LlamaChatResponse = z.object({
	choices: z.array(
		z.object({
			message: z.object({
				content: z.string(),
			}),
		}),
	),
});

type LlamaChatResponse = z.infer<typeof LlamaChatResponse>;

interface LlamaChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

// We need to track the active llama-server process so we can stop it when we need to free up VRAM for whisperx.
let activeLlamaServerProcess: ChildProcess | null = null;

export const stopLlamaServer = (): void => {
	if (activeLlamaServerProcess) {
		logger.info('Stopping llama-server to free VRAM');
		killProcess('llama-server', activeLlamaServerProcess);
		activeLlamaServerProcess = null;
	}
};

export const ensureLlamaServerRunning = async (
	config: TranscriptionConfig,
): Promise<ChildProcess> => {
	if (activeLlamaServerProcess && activeLlamaServerProcess.exitCode === null) {
		logger.info('llama-server already running, reusing existing instance');
		return activeLlamaServerProcess;
	}

	// If the process exited unexpectedly, clean up the stale reference
	if (activeLlamaServerProcess) {
		logger.info('llama-server process exited unexpectedly, restarting');
		activeLlamaServerProcess = null;
	}

	const result = await startLlamaServer(config);
	activeLlamaServerProcess = result;
	return result;
};

export const getLlamaServerArgs = (config: ServerConfig): string[] => {
	return [
		'-m',
		config.modelPath,
		'--port',
		`${config.port}`,
		'-c',
		'24576', // 24k context — large docs exceed the default ~4k
		'-ngl',
		'99', // offload all layers to GPU (Qwen3-8B Q4 fits on a T4)
		'-fa',
		'on', // flash attention reduces memory footprint - seems generally sensible to turn on where supported
		'--parallel',
		LOCAL_LLAMA_PARALLEL_JOBS.toString(),
		// disable cache - there's no real overlap between tasks we send to llama-server
		'--no-cache-prompt',
		'--cache-ram',
		'0',
	];
};

export const startLlamaServer = async (
	config: TranscriptionConfig,
): Promise<ChildProcess> => {
	logger.info('Starting llama-server...');

	const serverConfig = getServerConfig(config);

	const args = getLlamaServerArgs(serverConfig);

	logger.info(`Starting llama-server with args: ${args.join(' ')}`);
	try {
		const { stdout, stderr } = await promisify(execFile)(
			serverConfig.executable,
			['--version'],
			{
				timeout: 5000,
				maxBuffer: 64 * 1024,
				env: {
					...process.env,
					...(serverConfig.libPath
						? { LD_LIBRARY_PATH: serverConfig.libPath }
						: {}),
				},
			},
		);
		logger.info('llama-server runtime diagnostics', {
			llamaVersion: `${stdout}\n${stderr}`.trim(),
			nodeVersion: process.version,
			modelPath: serverConfig.modelPath,
		});
	} catch {
		logger.warn('Could not read llama-server version; continuing startup');
	}

	const childProcess = spawnBackgroundProcess(
		'llama-server',
		serverConfig.executable,
		args,
		serverConfig.libPath ? { LD_LIBRARY_PATH: serverConfig.libPath } : {},
	);

	await waitForLlamaServer(serverConfig.serverUrl);

	return childProcess;
};

export const waitForLlamaServer = async (
	url: string,
	timeoutSeconds: number = 120,
): Promise<void> => {
	const healthUrl = `${url}/health`;
	const deadline = Date.now() + timeoutSeconds * 1000;

	logger.info(
		`Waiting for llama-server to be ready at ${healthUrl} (timeout: ${timeoutSeconds}s)`,
	);

	while (Date.now() < deadline) {
		try {
			const response = await fetch(healthUrl);
			if (response.ok) {
				logger.info('llama-server is ready');
				return;
			}
		} catch {
			// Server not yet accepting connections – keep polling
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(
		`llama-server did not become ready within ${timeoutSeconds}s`,
	);
};

const buildMessages = (prompts: LlmPrompt): LlamaChatMessage[] => {
	const messages: LlamaChatMessage[] = [];
	if (prompts.system) {
		messages.push({ role: 'system', content: prompts.system });
	}
	messages.push({ role: 'user', content: prompts.user });
	if (prompts.assistant) {
		messages.push({ role: 'assistant', content: prompts.assistant });
	}
	return messages;
};

// llama-server doesn't return any headers until the prompt is fully processed so we need a long timeout here
const llamaDispatcher = new Agent({
	headersTimeout: 10 * 60 * 1000, // 10 minutes
	bodyTimeout: 10 * 60 * 1000, // 10 minutes
});

// Inspect metadata before schema parsing: Zod strips fields such as reasoning_content.
// Never include generated text or prompts in these diagnostics.
const asRecord = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const textMetadata = (value: unknown) => ({
	type: value === null ? 'null' : typeof value,
	length: typeof value === 'string' ? value.length : undefined,
	trimmedLength: typeof value === 'string' ? value.trim().length : undefined,
});

export const summarizeLlamaResponse = (json: unknown) => {
	const response = asRecord(json);
	const choices = Array.isArray(response.choices) ? response.choices : [];
	const usage = asRecord(response.usage);
	return {
		responseId: typeof response.id === 'string' ? response.id : undefined,
		responseModel:
			typeof response.model === 'string' ? response.model : undefined,
		choiceCount: choices.length,
		promptTokens:
			typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
		completionTokens:
			typeof usage.completion_tokens === 'number'
				? usage.completion_tokens
				: undefined,
		choices: choices.map((value) => {
			const choice = asRecord(value);
			const message = asRecord(choice.message);
			return {
				finishReason:
					typeof choice.finish_reason === 'string'
						? choice.finish_reason
						: undefined,
				content: textMetadata(message.content),
				reasoningContent: textMetadata(message.reasoning_content),
				toolCallCount: Array.isArray(message.tool_calls)
					? message.tool_calls.length
					: 0,
			};
		}),
	};
};

// The shared logger accepts scalar metadata; encode nested diagnostics as JSON.
const logMetadata = (
	metadata: Record<string, unknown>,
): Record<string, string | number> =>
	Object.fromEntries(
		Object.entries(metadata)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => [
				key,
				typeof value === 'string' || typeof value === 'number'
					? value
					: JSON.stringify(value),
			]),
	);

export const sendPromptToLlamaServer = async (
	url: string,
	prompts: LlmPrompt,
	chunkIndex?: number,
): Promise<string> => {
	const messages = buildMessages(prompts);
	const body = JSON.stringify({
		messages,
		chat_template_kwargs: { enable_thinking: false },
	});
	const startedAt = Date.now();
	const requestMetadata = {
		llamaRequestId: randomUUID(),
		chunkIndex,
		requestSha256: createHash('sha256').update(body).digest('hex'),
		messageRoles: messages.map((message) => message.role),
		messageLengths: messages.map((message) => message.content.length),
	};

	logger.info(
		`Sending prompt to llama-server at ${url} (${messages.length} messages, user prompt length: ${prompts.user.length} chars)`,
		logMetadata(requestMetadata),
	);

	const response = await fetch(`${url}/v1/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body,
		signal: AbortSignal.timeout(10 * 60 * 1000), // 10 minutes – generation on a T4 can exceed the default 5min undici timeout
		// @ts-expect-error — dispatcher is supported by Node.js fetch but not in the standard RequestInit types
		dispatcher: llamaDispatcher,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`llama-server request failed with status ${response.status}: ${errorText}`,
		);
	}

	const json = await response.json();
	const responseMetadata = {
		...requestMetadata,
		status: response.status,
		elapsedMs: Date.now() - startedAt,
		...summarizeLlamaResponse(json),
	};
	logger.info(
		'llama-server response diagnostics',
		logMetadata(responseMetadata),
	);
	const result = LlamaChatResponse.safeParse(json);

	if (!result.success) {
		logger.error(
			'Failed to parse response from llama-server',
			responseMetadata,
		);
		throw new Error('Failed to parse response from llama-server');
	}

	const content = result.data.choices[0]?.message.content;
	if (!content) {
		logger.error(
			'llama-server returned an empty response',
			logMetadata(responseMetadata),
		);
		throw new Error('llama-server returned an empty response');
	}

	logger.info(
		`Received response from llama-server (response length: ${content.length} chars)`,
		logMetadata(requestMetadata),
	);

	return content;
};
