import {
	logger,
	publishTranscriptionOutput,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import fs from 'node:fs';
import {
	LLMJob,
	LlmPrompt,
	type LLMOutputSuccess,
	uploadToS3,
	LLMTranslationJob,
	LlmBackend,
	TranslationTask,
	TranslationField,
} from '@guardian/transcription-service-common';
import { MessageAttributeValue, SQSClient } from '@aws-sdk/client-sqs';

import { gzip } from 'node-gzip';
import { executeLlmPrompt } from './llm';

export const getS3Keys = (id: string) => ({
	promptKey: `llm-prompts/${id}.txt`,
	outputKey: `llm-output/${id}.txt`,
});

const processTranslationTask = async (
	taskData: string,
	config: TranscriptionConfig,
	backend: LlmBackend,
	setMessageVisibility: (visibilityTimeoutSeconds: number) => Promise<void>,
): Promise<string> => {
	const parsedTask = TranslationTask.safeParse(JSON.parse(taskData));
	if (!parsedTask.success) {
		throw new Error(
			`Failed to parse translation task file, content: ${taskData}`,
		);
	}
	// each field for translation gets a different prompt
	const prompts: { fieldName: string; prompt: LlmPrompt }[] =
		parsedTask.data.fields.map((field: TranslationField) => ({
			fieldName: field.name,
			prompt: {
				system: parsedTask.data.systemPrompt,
				user: field.text,
			},
		}));

	const promptOutputs: TranslationField[] = [];
	for (const prompt of prompts) {
		const result = await executeLlmPrompt(
			prompt.prompt,
			config,
			backend,
			setMessageVisibility,
		);
		promptOutputs.push({
			name: prompt.fieldName,
			text: result,
		});
	}
	return JSON.stringify(promptOutputs);
};

const processLLmPrompt = async (
	taskData: string,
	config: TranscriptionConfig,
	backend: LlmBackend,
	setMessageVisibility: (visibilityTimeoutSeconds: number) => Promise<void>,
) => {
	const parsedPrompts = LlmPrompt.safeParse(JSON.parse(taskData));
	if (!parsedPrompts.success) {
		throw new Error(`Failed to parse prompt file, content: ${taskData}`);
	}
	return executeLlmPrompt(
		parsedPrompts.data,
		config,
		backend,
		setMessageVisibility,
	);
};

export const processLLMOrTranslationJob = async (
	job: LLMJob | LLMTranslationJob,
	downloadedFile: string,
	config: TranscriptionConfig,
	sqsClient: SQSClient,
	setMessageVisibility: (visibilityTimeoutSeconds: number) => Promise<void>,
	messageAttributes?: Record<string, MessageAttributeValue>,
) => {
	logger.info(`Processing LLM job with id ${job.id}`);

	const taskData = fs.readFileSync(downloadedFile, 'utf-8');

	const llmResult =
		job.jobType === 'llm'
			? await processLLmPrompt(
					taskData,
					config,
					job.backend,
					setMessageVisibility,
				)
			: await processTranslationTask(
					taskData,
					config,
					job.backend,
					setMessageVisibility,
				);

	const gzippedResult = await gzip(llmResult);

	const uploadResult = await uploadToS3(
		job.combinedOutputUrl.url,
		Buffer.from(gzippedResult),
		true, // gzip as, especially results from giant document translations, output will be quite large
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
		messageAttributes,
	);

	logger.info(
		`Worker successfully processed LLM job and sent notification to ${job.transcriptDestinationService} output queue`,
		{
			id: llmOutput.id,
			userEmail: llmOutput.userEmail,
		},
	);
};
