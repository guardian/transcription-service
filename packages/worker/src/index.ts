import {
	getConfig,
	getSQSClient,
	getNextMessage,
	parseTranscriptJobMessage,
	isFailure,
	deleteMessage,
	getFile,
	getS3Client,
	changeMessageVisibility,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import type { TranscriptionOutput } from '@guardian/transcription-service-common';
import { getSNSClient, publishTranscriptionOutput } from './sns';
import {
	getTranscriptionText,
	convertToWav,
	getOrCreateContainer,
} from './transcribe';
import path from 'path';
import { updateScaleInProtection } from './asg';

const main = async () => {
	const config = await getConfig();
	const stage = config.app.stage;
	console.log('stage is: ', stage);

	const numberOfThreads = config.app.stage === 'PROD' ? 16 : 2;

	const client = getSQSClient(config.aws.region, config.aws.localstackEndpoint);
	const message = await getNextMessage(client, config.app.taskQueueUrl);

	if (isFailure(message)) {
		console.error(`Failed to fetch message due to ${message.errorMsg}`);
		await updateScaleInProtection(stage, false);
		return;
	}

	if (!message.message) {
		console.log('No messages available');
		await updateScaleInProtection(stage, false);
		return;
	}

	try {
		const snsClient = getSNSClient(
			config.aws.region,
			config.aws.localstackEndpoint,
		);

		const job = parseTranscriptJobMessage(message.message);

		console.log(
			`Fetched transcription job with id ${message.message.MessageId}}`,
			job,
		);

		if (!job) {
			console.error('Failed to parse job message', message);
			return;
		}

		const fileToTranscribe = await getFileFromS3(config, job.s3Key);

		console.log('file is here');

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

		const text = await getTranscriptionText(
			containerId,
			ffmpegResult.wavPath,
			fileToTranscribe,
			numberOfThreads,
		);

		const transcriptionOutput: TranscriptionOutput = {
			id: job.id,
			transcriptionSrt: text,
			languageCode: 'en',
			userEmail: job.userEmail,
			originalFilename: job.originalFilename,
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
		await updateScaleInProtection(stage, false);
	}
};

const getFileFromS3 = async (config: TranscriptionConfig, s3Key: string) => {
	const s3Client = getS3Client(config.aws.region);

	const file = await getFile(
		s3Client,
		config.app.sourceMediaBucket,
		s3Key,
		config.app.stage === 'DEV' ? `${__dirname}/sample` : '/tmp',
	);

	return file;
};

main();
