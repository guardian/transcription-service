import {
	getConfig,
	getSQSClient,
	getNextMessage,
	parseTranscriptJobMessage,
	isSqsFailure,
	deleteMessage,
	changeMessageVisibility,
	getObjectWithPresignedUrl,
	TranscriptionConfig,
	moveMessageToDeadLetterQueue,
	logger,
} from '@guardian/transcription-service-backend-common';
import {
	OutputBucketKeys,
	TranscriptionJob,
	TranscriptionOutputFailure,
	type TranscriptionOutputSuccess,
} from '@guardian/transcription-service-common';
import { getSNSClient, publishTranscriptionOutput } from './sns';
import {
	getTranscriptionText,
	convertToWav,
	getOrCreateContainer,
} from './transcribe';
import path from 'path';

import { updateScaleInProtection } from './asg';
import { uploadAllTranscriptsToS3 } from './util';
import {
	MetricsService,
	FailureMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { setTimeout } from 'timers/promises';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common';

const POLLING_INTERVAL_SECONDS = 30;

const main = async () => {
	const config = await getConfig();

	const metrics = new MetricsService(
		config.app.stage,
		config.aws.region,
		'worker',
	);

	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);
	const snsClient = getSNSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);

	let pollCount = 0;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		pollCount += 1;
		await pollTranscriptionQueue(
			pollCount,
			sqsClient,
			snsClient,
			metrics,
			config,
		);
		await setTimeout(POLLING_INTERVAL_SECONDS * 1000);
	}
};

const publishTranscriptionOutputFailure = async (
	snsClient: SNSClient,
	destination: string,
	job: TranscriptionJob,
) => {
	logger.info('publishing transcription output failed');
	const failureMessage: TranscriptionOutputFailure = {
		id: job.id,
		status: 'FAILURE',
		languageCode: 'en',
		userEmail: job.userEmail,
		originalFilename: job.originalFilename,
	};
	try {
		await publishTranscriptionOutput(snsClient, destination, failureMessage);
	} catch (e) {
		logger.error('error publishing transcription output failed', e);
	}
};

const pollTranscriptionQueue = async (
	pollCount: number,
	sqsClient: SQSClient,
	snsClient: SNSClient,
	metrics: MetricsService,
	config: TranscriptionConfig,
) => {
	const stage = config.app.stage;
	const region = config.aws.region;
	const numberOfThreads = config.app.stage === 'PROD' ? 16 : 2;
	const isDev = config.app.stage === 'DEV';

	logger.info(
		`worker polling for transcription task. Poll count = ${pollCount}`,
	);

	await updateScaleInProtection(region, stage, true);

	const message = await getNextMessage(sqsClient, config.app.taskQueueUrl);

	if (isSqsFailure(message)) {
		logger.error(`Failed to fetch message due to ${message.errorMsg}`);
		await updateScaleInProtection(region, stage, false);
		return;
	}

	if (!message.message) {
		logger.info('No messages available');
		await updateScaleInProtection(region, stage, false);
		return;
	}

	const taskMessage = message.message;
	if (!taskMessage.Body) {
		logger.error('message missing body');
		await updateScaleInProtection(region, stage, false);
		return;
	}
	if (!taskMessage.Attributes && !isDev) {
		logger.error('message missing attributes');
		await updateScaleInProtection(region, stage, false);
		return;
	}

	const receiptHandle = taskMessage.ReceiptHandle;
	if (!receiptHandle) {
		logger.error('message missing receipt handle');
		await updateScaleInProtection(region, stage, false);
		return;
	}

	const job = parseTranscriptJobMessage(taskMessage);

	if (!job) {
		await metrics.putMetric(FailureMetric);
		logger.error('Failed to parse job message', message);
		await updateScaleInProtection(region, stage, false);
		return;
	}

	try {
		// from this point all worker logs will have id & userEmail in their fields
		logger.setCommonMetadata(job.id, job.userEmail);

		const { outputBucketUrls, inputSignedUrl } = job;

		logger.info(`Fetched transcription job with id ${taskMessage.MessageId}`);

		const destinationDirectory = isDev ? `${__dirname}/sample` : '/tmp';

		const fileToTranscribe = await getObjectWithPresignedUrl(
			inputSignedUrl,
			job.id,
			destinationDirectory,
		);

		// docker container to run ffmpeg and whisper on file
		const containerId = await getOrCreateContainer(
			path.parse(fileToTranscribe).dir,
		);

		const ffmpegResult = await convertToWav(containerId, fileToTranscribe);
		if (ffmpegResult === undefined) {
			// when ffmpeg fails to transcribe, move message to the dead letter
			// queue
			if (!isDev && config.app.deadLetterQueueUrl) {
				logger.error(
					`'ffmpeg failed, moving message with message id ${taskMessage.MessageId} to dead letter queue`,
				);
				await moveMessageToDeadLetterQueue(
					sqsClient,
					config.app.taskQueueUrl,
					config.app.deadLetterQueueUrl,
					taskMessage.Body,
					receiptHandle,
					job.id,
				);
				logger.info(
					`moved message with message id ${taskMessage.MessageId} to dead letter queue.`,
				);
			} else {
				logger.info('skip moving message to dead letter queue in DEV');
			}
			await publishTranscriptionOutputFailure(
				snsClient,
				config.app.destinationTopicArns.transcriptionService,
				job,
			);
			return;
		}

		if (ffmpegResult.duration && ffmpegResult.duration !== 0) {
			// Adding 300 seconds (5 minutes) and the file duration
			// to allow time to load the whisper model
			await changeMessageVisibility(
				sqsClient,
				config.app.taskQueueUrl,
				receiptHandle,
				ffmpegResult.duration + 300,
			);
		}

		const transcriptResult = await getTranscriptionText(
			containerId,
			ffmpegResult.wavPath,
			fileToTranscribe,
			numberOfThreads,
			config.app.stage === 'PROD' ? 'medium' : 'tiny',
		);

		await uploadAllTranscriptsToS3(
			outputBucketUrls,
			transcriptResult.transcripts,
		);

		const outputBucketKeys: OutputBucketKeys = {
			srt: outputBucketUrls.srt.key,
			json: outputBucketUrls.json.key,
			text: outputBucketUrls.text.key,
		};

		const transcriptionOutput: TranscriptionOutputSuccess = {
			id: job.id,
			status: 'SUCCESS',
			languageCode: transcriptResult.metadata.detectedLanguageCode || 'en',
			userEmail: job.userEmail,
			originalFilename: job.originalFilename,
			outputBucketKeys,
		};

		await publishTranscriptionOutput(
			snsClient,
			config.app.destinationTopicArns.transcriptionService,
			transcriptionOutput,
		);

		logger.info(
			'Worker successfully transcribed the file and sent notification to sns',
			{
				id: transcriptionOutput.id,
				filename: transcriptionOutput.originalFilename,
				userEmail: transcriptionOutput.userEmail,
				fileDuration: ffmpegResult.duration?.toString() || '',
				...transcriptResult.metadata,
			},
		);

		logger.info(`Deleting message ${taskMessage.MessageId}`);
		await deleteMessage(sqsClient, config.app.taskQueueUrl, receiptHandle);
	} catch (error) {
		const msg = 'Worker failed to complete';
		logger.error(msg, error);
		await metrics.putMetric(FailureMetric);
		// Terminate the message visibility timeout
		await changeMessageVisibility(
			sqsClient,
			config.app.taskQueueUrl,
			receiptHandle,
			0,
		);

		// the type of ApproximateReceiveCount is string | undefined so need to
		// handle the case where its missing. use default value
		// MAX_RECEIVE_COUNT since its probably better to send too many failure
		// messages than to not send any.
		const defaultReceiveCount = MAX_RECEIVE_COUNT.toString();
		const receiveCount = parseInt(
			taskMessage.Attributes?.ApproximateReceiveCount || defaultReceiveCount,
		);
		if (receiveCount >= MAX_RECEIVE_COUNT) {
			publishTranscriptionOutputFailure(
				snsClient,
				config.app.destinationTopicArns.transcriptionService,
				job,
			);
		}
	} finally {
		logger.resetCommonMetadata();
		await updateScaleInProtection(region, stage, false);
	}
};

main();
