import {
	changeMessageVisibility,
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
} from '@guardian/transcription-service-common';
import { SQSClient } from '@aws-sdk/client-sqs';

import { executePrompt } from './llama-server';
import { sendPromptToBedrock } from '@guardian/transcription-service-backend-common/src/llm';

export const getS3Keys = (id: string) => ({
	promptKey: `llm-prompts/${id}.txt`,
	outputKey: `llm-output/${id}.txt`,
});

export const processLLMJob = async (
	job: LLMJob,
	downloadedFile: string,
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
		300, // 5 minutes
	);

	const llmResult =
		job.backend === 'BEDROCK'
			? await sendPromptToBedrock(parsedPrompts.data)
			: await executePrompt(config.app.stage, parsedPrompts.data);

	const uploadResult = await uploadToS3(
		job.combinedOutputUrl.url,
		Buffer.from(llmResult),
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
