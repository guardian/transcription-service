import {
	getConfig,
	getFileFromS3,
	getSQSClient,
	getNextMessage,
	parseTranscriptJobMessage,
	isFailure,
	deleteMessage,
	changeMessageVisibility,
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

const main = async () => {
	const config = await getConfig();
	const stage = config.app.stage;
	const region = config.aws.region;

	const metrics = new MetricsService(
		config.app.stage,
		config.aws.region,
		'worker',
	);

	const numberOfThreads = config.app.stage === 'PROD' ? 16 : 2;

	const client = getSQSClient(region, config.aws.localstackEndpoint);
	const message = await getNextMessage(client, config.app.taskQueueUrl);

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

	try {
		const snsClient = getSNSClient(
			config.aws.region,
			config.aws.localstackEndpoint,
		);

		const job = parseTranscriptJobMessage(message.message);

		if (!job) {
			await metrics.putMetric(FailureMetric);
			console.error('Failed to parse job message', message);
			return;
		}

		const { outputBucketUrls, ...loggableJob } = job;

		console.log(
			`Fetched transcription job with id ${message.message.MessageId}}`,
			loggableJob,
		);

		const destinationDirectory =
			config.app.stage === 'DEV' ? `${__dirname}/sample` : '/tmp';

		const fileToTranscribe = await getFileFromS3(
			config.aws.region,
			destinationDirectory,
			config.app.sourceMediaBucket,
			job.inputSignedUrl,
		);

		// docker container to run ffmpeg and whisper on file
		const containerId = await getOrCreateContainer(
			path.parse(fileToTranscribe).dir,
		);

		const ffmpegResult = await convertToWav(containerId, fileToTranscribe);

		if (
			message.message?.ReceiptHandle &&
			ffmpegResult.duration &&
			ffmpegResult.duration !== 0
		) {
			// Adding 300 seconds (5 minutes) and the file duration
			// to allow time to load the whisper model
			await changeMessageVisibility(
				client,
				config.app.taskQueueUrl,
				message.message.ReceiptHandle,
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

		if (message.message?.ReceiptHandle) {
			console.log(`Deleting message ${message.message?.MessageId}`);
			await deleteMessage(
				client,
				config.app.taskQueueUrl,
				message.message.ReceiptHandle,
			);
		}
	} catch (error) {
		const msg = 'Worker failed to complete';
		console.error(msg, error);
		await metrics.putMetric(FailureMetric);
		if (message.message?.ReceiptHandle) {
			// Terminate the message visibility timeout
			await changeMessageVisibility(
				client,
				config.app.taskQueueUrl,
				message.message.ReceiptHandle,
				0,
			);
		}
	} finally {
		await updateScaleInProtection(region, stage, false);
	}
};

main();
