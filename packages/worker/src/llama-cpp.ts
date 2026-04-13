import {
	changeMessageVisibility,
	logger,
	publishTranscriptionOutput,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import {
	LLMJob,
	LlmPrompt,
	type LLMOutputSuccess,
	uploadToS3,
} from '@guardian/transcription-service-common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { z } from 'zod';

const LLAMA_SERVER_URL =
	process.env.LLAMA_SERVER_URL ?? 'http://localhost:9080';

const USE_SERVER = false;

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

const LLAMA_CLI_MODEL_PATH = '/opt/dlami/nvme/Qwen3-8B-Q4_K_M.gguf';

export const sendPromptToLlamaCli = (prompts: LlmPrompt): string => {
	// Write prompts to temporary files to avoid shell injection and ARG_MAX issues
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-cli-'));
	const userPromptFile = path.join(tmpDir, 'prompt.txt');
	fs.writeFileSync(userPromptFile, prompts.user, 'utf-8');

	const args: string[] = [
		'--model',
		LLAMA_CLI_MODEL_PATH,
		'--file',
		userPromptFile,
	];

	let systemPromptFile: string | undefined;
	if (prompts.system) {
		systemPromptFile = path.join(tmpDir, 'system-prompt.txt');
		fs.writeFileSync(systemPromptFile, prompts.system, 'utf-8');
		args.push('--system-prompt-file', systemPromptFile);
	}

	logger.info(
		`Running llama-cli with model ${LLAMA_CLI_MODEL_PATH} (prompt length: ${prompts.user.length} chars)`,
	);

	try {
		const output = execFileSync(
			'/opt/llama/llama.cpp/install/bin/llama-cli',
			args,
			{
				env: {
					...process.env,
					LD_LIBRARY_PATH: '/opt/llama/llama.cpp/install/lib/',
				},
				encoding: 'utf-8',
				maxBuffer: 50 * 1024 * 1024, // 50 MB
			},
		);

		logger.info(
			`Received response from llama-cli (response length: ${output.length} chars)`,
		);

		return output;
	} finally {
		// Clean up temporary files
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
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

	// Set a generous visibility timeout for LLM processing
	await changeMessageVisibility(
		sqsClient,
		taskQueueUrl,
		receiptHandle,
		600, // 10 minutes
	);

	const llmResult = USE_SERVER
		? await sendPromptToLlamaServer(parsedPrompts.data)
		: sendPromptToLlamaCli(parsedPrompts.data);

	const outputPath = saveLLMResult(destinationDirectory, job.id, llmResult);

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
