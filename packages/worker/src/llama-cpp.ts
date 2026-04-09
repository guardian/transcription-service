import {
	changeMessageVisibility,
	logger,
	publishTranscriptionOutput,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
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
export const sendPromptToLlama = async (
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

	const llmResult = await sendPromptToLlama(parsedPrompts.data);

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
