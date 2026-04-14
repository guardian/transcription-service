import {
	changeMessageVisibility,
	logger,
	publishTranscriptionOutput,
	TranscriptionConfig,
	spawnBackgroundProcess,
} from '@guardian/transcription-service-backend-common';
import type { ChildProcess } from 'child_process';
import fs from 'node:fs';
import path from 'path';
import {
	LLMJob,
	LlmPrompt,
	type LLMOutputSuccess,
	uploadToS3,
} from '@guardian/transcription-service-common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { z } from 'zod';

const LLAMA_MODEL_PATH = '/opt/dlami/nvme/Qwen3-8B-Q4_K_M.gguf';
const LLAMA_SERVER_BIN = '/opt/llama/llama.cpp/install/bin/llama-server';
const LLAMA_LIB_PATH = '/opt/llama/llama.cpp/install/lib/';
const LLAMA_SERVER_PORT = '9080';
const LLAMA_SERVER_URL =
	process.env.LLAMA_SERVER_URL ?? 'http://localhost:9080';

interface LlamaChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export const getS3Keys = (id: string) => ({
	promptKey: `llm-prompts/${id}.txt`,
	outputKey: `llm-output/${id}.txt`,
});

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

/**
 * Send a prompt to the llama-server OpenAI-compatible chat completions API
 * and return the response text.
 */
export const sendPromptToLlamaServer = async (
	prompts: LlmPrompt,
): Promise<string> => {
	const messages = buildMessages(prompts);

	logger.info(
		`Sending prompt to llama-server at ${LLAMA_SERVER_URL} (${messages.length} messages, user prompt length: ${prompts.user.length} chars)`,
	);

	const response = await fetch(`${LLAMA_SERVER_URL}/v1/chat/completions`, {
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

/**
 * Start llama-server as a background process and wait for it to be ready.
 */
export const startLlamaServer = async (): Promise<ChildProcess> => {
	logger.info('Starting llama-server...');

	const cp = spawnBackgroundProcess(
		'startLlamaServer',
		LLAMA_SERVER_BIN,
		['-m', LLAMA_MODEL_PATH, '--port', LLAMA_SERVER_PORT],
		{ LD_LIBRARY_PATH: LLAMA_LIB_PATH },
	);

	await waitForLlamaServer();

	return cp;
};

/**
 * Poll the llama-server health endpoint until it responds, with a timeout.
 */
const waitForLlamaServer = async (
	timeoutMs: number = 120_000,
	intervalMs: number = 1_000,
): Promise<void> => {
	const healthUrl = `${LLAMA_SERVER_URL}/health`;
	const deadline = Date.now() + timeoutMs;

	logger.info(
		`Waiting for llama-server to be ready at ${healthUrl} (timeout: ${timeoutMs}ms)`,
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
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}

	throw new Error(
		`llama-server did not become ready within ${timeoutMs / 1000}s`,
	);
};

/**
 * Stop llama-server by killing the child process.
 */
export const stopLlamaServer = (cp: ChildProcess): void => {
	logger.info('Stopping llama-server...');
	cp.kill('SIGTERM');
	logger.info('llama-server stop signal sent');
};

/**
 * Save the LLM result to a file and return the file path.
 */
export const saveLLMResult = (
	outputDirectory: string,
	jobId: string,
	result: string,
): string => {
	const outputPath = path.resolve(outputDirectory, `${jobId}-llm-output.txt`);
	fs.writeFileSync(outputPath, result, 'utf-8');
	logger.info(`LLM result saved to ${outputPath}`);
	logger.info(`result: ${result}`);
	return outputPath;
};

export const processLLMJob = async (
	job: LLMJob,
	downloadedFile: string,
	destinationDirectory: string,
	sqsClient: SQSClient,
	config: TranscriptionConfig,
	taskQueueUrl: string,
	receiptHandle: string,
) => {
	logger.info(`Processing LLM job with id ${job.id}`);

	const fileContent = fs.readFileSync(downloadedFile, 'utf-8');

	const parsedPrompts = LlmPrompt.safeParse(JSON.parse(fileContent));
	if (!parsedPrompts.success) {
		throw new Error(`Failed to parse prompt file, content: ${fileContent}`);
	}

	// start llama-server
	const llamaProcess = await startLlamaServer();

	// Set a generous visibility timeout for LLM processing
	await changeMessageVisibility(
		sqsClient,
		taskQueueUrl,
		receiptHandle,
		600, // 10 minutes
	);

	const llmResult = await sendPromptToLlamaServer(parsedPrompts.data);

	const outputPath = saveLLMResult(destinationDirectory, job.id, llmResult);

	// stop llama-server
	stopLlamaServer(llamaProcess);

	const resultBuffer = fs.readFileSync(outputPath);
	const uploadResult = await uploadToS3(
		job.combinedOutputUrl.url,
		resultBuffer,
		false,
	);
	if (!uploadResult.isSuccess) {
		throw new Error(
			`Could not upload LLM results to S3! ${uploadResult.errorMsg}`,
		);
	}
	logger.info('Successfully uploaded LLM results to S3');

	const llmOutput: LLMOutputSuccess = {
		id: job.id,
		status: 'LLM_SUCCESS',
		userEmail: job.userEmail,
		outputKey: job.combinedOutputUrl.key,
	};

	await publishTranscriptionOutput(
		sqsClient,
		config.app.destinationQueueUrls[job.transcriptDestinationService],
		llmOutput,
	);

	logger.info(
		`Worker successfully processed LLM job and sent notification to ${job.transcriptDestinationService} output queue`,
		{
			id: llmOutput.id,
			userEmail: llmOutput.userEmail,
		},
	);
};
