import type { ChildProcess } from 'child_process';
import {
	killProcess,
	logger,
	spawnBackgroundProcess,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { LlmPrompt } from '@guardian/transcription-service-common';
import { z } from 'zod';
import { Agent } from 'undici';
import { PARALLEL_JOBS } from './llm';

type ServerConfig = {
	modelPath: string;
	executable: string;
	libPath?: string;
};

const PORT = '9080';
export const LLAMA_SERVER_URL = `http://localhost:${PORT}`;

const getServerConfig = (config: TranscriptionConfig): ServerConfig => {
	return {
		modelPath: config.llamacpp.modelPath,
		executable: 'llama-server',
		libPath:
			config.llamacpp.installDirectory && config.app.stage !== 'DEV'
				? `${config.llamacpp.installDirectory}/lib/`
				: undefined,
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

export const startLlamaServer = async (
	config: TranscriptionConfig,
): Promise<ChildProcess> => {
	logger.info('Starting llama-server...');

	const { modelPath, executable, libPath } = getServerConfig(config);

	const args = [
		'-m',
		modelPath,
		'--port',
		PORT,
		'-c',
		'12288', // 12k context — large docs exceed the default ~4k
		'-ngl',
		'99', // offload all layers to GPU (Qwen3-8B Q4 fits on a T4)
		'-fa',
		'on', // flash attention reduces memory footprint - seems generally sensible to turn on where supported
		'--parallel',
		PARALLEL_JOBS.toString(),
	];

	logger.info(`Starting llama-server with args: ${args.join(' ')}`);

	const childProcess = spawnBackgroundProcess(
		'llama-server',
		executable,
		args,
		libPath ? { LD_LIBRARY_PATH: libPath } : {},
	);

	await waitForLlamaServer(LLAMA_SERVER_URL);

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
	messages.push({ role: 'user', content: prompts.user });
	if (prompts.system) {
		messages.push({ role: 'system', content: prompts.system });
	}
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

export const sendPromptToLlamaServer = async (
	url: string,
	prompts: LlmPrompt,
): Promise<string> => {
	const messages = buildMessages(prompts);

	logger.info(
		`Sending prompt to llama-server at ${url} (${messages.length} messages, user prompt length: ${prompts.user.length} chars)`,
	);

	const response = await fetch(`${url}/v1/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			messages,
		}),
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
	const result = LlamaChatResponse.safeParse(json);

	if (!result.success) {
		throw new Error('Failed to parse response from llama-server');
	}

	const content = result.data.choices[0]?.message.content;
	if (!content) {
		throw new Error('llama-server returned an empty response');
	}

	logger.info(
		`Received response from llama-server (response length: ${content.length} chars)`,
	);

	return content;
};
