import type { ChildProcess } from 'child_process';
import {
	killProcess,
	logger,
	spawnBackgroundProcess,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { LlmPrompt } from '@guardian/transcription-service-common';
import { z } from 'zod';

type ServerConfig = {
	modelPath: string;
	executable: string;
	libPath?: string;
	port: string;
};

const getServerConfig = (config: TranscriptionConfig): ServerConfig => {
	return {
		modelPath: config.llamacpp.modelPath,
		executable: 'llama-server',
		port: '9080',
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

export const startLlamaServer = async (
	config: TranscriptionConfig,
): Promise<{
	serverProcess: ChildProcess;
	url: string;
}> => {
	logger.info('Starting llama-server...');

	const { modelPath, executable, libPath, port } = getServerConfig(config);

	const childProcess = spawnBackgroundProcess(
		'llama-server',
		executable,
		['-m', modelPath, '--port', port],
		libPath ? { LD_LIBRARY_PATH: libPath } : {},
	);

	const url = `http://localhost:${port}`;

	await waitForLlamaServer(url);

	return {
		serverProcess: childProcess,
		url,
	};
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

export const executePrompt = async (
	config: TranscriptionConfig,
	prompts: LlmPrompt,
) => {
	const serverConfig = await startLlamaServer(config);
	const llmResult = await sendPromptToLlamaServer(serverConfig!.url, prompts);
	killProcess('llama-server', serverConfig.serverProcess);
	return llmResult;
};
