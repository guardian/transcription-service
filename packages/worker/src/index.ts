import {
	getConfig,
	getSQSClient,
	getNextMessage,
	parseTranscriptJobMessage,
	isFailure,
	deleteMessage,
	changeMessageVisibility,
	getObjectWithPresignedUrl,
	TranscriptionConfig,
	moveMessageToDeadLetterQueue,
} from '@guardian/transcription-service-backend-common';
import {
	OutputBucketKeys,
	type TranscriptionOutput,
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

	console.log(
		`worker polling for transcription task. Poll count = ${pollCount}`,
	);

	await updateScaleInProtection(region, stage, true);

	const message = await getNextMessage(sqsClient, config.app.taskQueueUrl);

	if (isFailure(message)) {
		console.error(`Failed to fetch message due to ${message.errorMsg}`);
		await updateScaleInProtection(region, stage, false);
		return;
	}

	if (!message.message) {
		console.log('No messages available');
		await updateScaleInProtection(region, stage, false);
		return;
	}

	const taskMessage = message.message;
	if (!taskMessage.Body) {
		console.log('message missing body');
		await updateScaleInProtection(region, stage, false);
		return;
	}

	const receiptHandle = taskMessage.ReceiptHandle;
	if (!receiptHandle) {
		console.log('message missing receipt handle');
		await updateScaleInProtection(region, stage, false);
		return;
	}

	try {
		const job = parseTranscriptJobMessage(taskMessage);

		if (!job) {
			await metrics.putMetric(FailureMetric);
			console.error('Failed to parse job message', message);
			return;
		}

		const { outputBucketUrls, ...loggableJob } = job;

		console.log(
			`Fetched transcription job with id ${taskMessage.MessageId}`,
			loggableJob,
		);

		const destinationDirectory =
			config.app.stage === 'DEV' ? `${__dirname}/sample` : '/tmp';

		const fileToTranscribe = await getObjectWithPresignedUrl(
			job.inputSignedUrl,
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
			if (config.app.stage != 'DEV' && config.app.deadLetterQueueUrl) {
				console.log(
					`moving message with message id ${taskMessage.MessageId} to dead letter queue`,
				);
				await moveMessageToDeadLetterQueue(
					sqsClient,
					config.app.taskQueueUrl,
					config.app.deadLetterQueueUrl,
					taskMessage.Body,
					receiptHandle,
				);
			} else {
				console.log('skip moving message to dead letter queue in DEV');
			}
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

		const transcripts = await getTranscriptionText(
			containerId,
			ffmpegResult.wavPath,
			fileToTranscribe,
			numberOfThreads,
			config.app.stage === 'PROD' ? 'medium' : 'tiny',
		);

		await uploadAllTranscriptsToS3(outputBucketUrls, transcripts);

		const outputBucketKeys: OutputBucketKeys = {
			srt: outputBucketUrls.srt.key,
			json: outputBucketUrls.json.key,
			text: outputBucketUrls.text.key,
		};

		const transcriptionOutput: TranscriptionOutput = {
			id: job.id,
			languageCode: 'en',
			userEmail: job.userEmail,
			originalFilename: job.originalFilename,
			outputBucketKeys,
		};

		await publishTranscriptionOutput(
			snsClient,
			config.app.destinationTopicArns.transcriptionService,
			transcriptionOutput,
		);

		console.log(`Deleting message ${taskMessage.MessageId}`);
		await deleteMessage(sqsClient, config.app.taskQueueUrl, receiptHandle);
	} catch (error) {
		const msg = 'Worker failed to complete';
		console.error(msg, error);
		await metrics.putMetric(FailureMetric);
		// Terminate the message visibility timeout
		await changeMessageVisibility(
			sqsClient,
			config.app.taskQueueUrl,
			receiptHandle,
			0,
		);
	} finally {
		await updateScaleInProtection(region, stage, false);
	}
};

main();
