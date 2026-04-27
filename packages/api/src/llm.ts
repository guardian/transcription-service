import {
	getSignedDownloadUrl,
	getSignedUploadUrl,
	isSqsFailure,
	logger,
	putObject,
	sendMessage,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import {
	DestinationService,
	LLMJob,
	LLMOutputSuccess,
	LlmRequestBody,
	ONE_WEEK_IN_SECONDS,
} from '@guardian/transcription-service-common';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
	saveLllmOutput,
	sendPromptToBedrock,
} from '@guardian/transcription-service-backend-common/src/llm';
import { MetricsService } from '@guardian/transcription-service-backend-common/src/metrics';
import { S3Client } from '@aws-sdk/client-s3';

type SendLlmFailure = {
	status: 'failure';
	failureReason: string;
};
type SendLlmSuccess = {
	status: 'success';
};
type SendLlmResult = SendLlmFailure | SendLlmSuccess;

export const sendLlmResultIsSuccess = (
	result: SendLlmResult,
): result is { status: 'success' } => {
	return result.status === 'success';
};

export const sendLlmJob = async (
	id: string,
	userEmail: string,
	promptKey: string,
	outputKey: string,
	request: LlmRequestBody,
	sqsClient: SQSClient,
	config: TranscriptionConfig,
): Promise<SendLlmResult> => {
	const inputSignedUrl = await getSignedDownloadUrl(
		config.aws,
		config.app.sourceMediaBucket,
		promptKey,
		ONE_WEEK_IN_SECONDS,
	);
	const outputSignedUrl = await getSignedUploadUrl(
		config.aws,
		config.app.transcriptionOutputBucket,
		userEmail,
		ONE_WEEK_IN_SECONDS,
		false,
		outputKey,
	);

	const job: LLMJob = {
		id,
		jobType: 'llm',
		originalFilename: `${id}.txt`,
		inputSignedUrl,
		sentTimestamp: new Date().toISOString(),
		userEmail,
		transcriptDestinationService: DestinationService.TranscriptionService,
		combinedOutputUrl: { key: outputKey, url: outputSignedUrl },
		backend: request.backend,
	};

	const sendResult = await sendMessage(
		sqsClient,
		config.app.gpuTaskQueueUrl,
		JSON.stringify(job),
		id,
	);
	if (isSqsFailure(sendResult)) {
		return {
			status: 'failure',
			failureReason: sendResult.errorMsg || 'Failed to send llmb job to sqs',
		};
	}

	logger.info('API successfully sent LLM job to task queue', {
		id,
		userEmail,
		queue: config.app.gpuTaskQueueUrl,
	});
	return {
		status: 'success',
	};
};

export const bedrockLlmJob = async (
	id: string,
	userEmail: string,
	outputKey: string,
	request: LlmRequestBody,
	config: TranscriptionConfig,
	metricsService: MetricsService,
	s3Client: S3Client,
): Promise<SendLlmResult> => {
	const bedrockResponse = await sendPromptToBedrock(
		request.prompt,
		config.bedrock.modelId,
	);
	const s3Result = await putObject(
		s3Client,
		config.app.transcriptionOutputBucket,
		outputKey,
		bedrockResponse,
	);
	if (s3Result.httpStatusCode !== 200) {
		return {
			status: 'failure',
			failureReason: `Failed to upload bedrock output to s3, status code ${s3Result.httpStatusCode}`,
		};
	}
	const llmSuccess: LLMOutputSuccess = {
		id,
		userEmail,
		outputKey,
		status: 'LLM_SUCCESS',
	};
	const saveLlmSuccess = await saveLllmOutput(
		config,
		llmSuccess,
		metricsService,
	);
	if (!saveLlmSuccess) {
		return {
			status: 'failure',
			failureReason: 'Failed to save llm job to dynamo',
		};
	}
	return {
		status: 'success',
	};
};
