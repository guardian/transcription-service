import {
	getConfig,
	getClient,
	getNextMessage,
	parseTranscriptJobMessage,
	isFailure,
	deleteMessage,
	changeMessageVisibility,
	TranscriptionConfig,
	TranscriptionOutput,
} from '@guardian/transcription-service-common';
import { getSNSClient, publishTranscriptionOutput } from './sns';
import {
	getTranscriptionText,
	convertToWav,
	createContainer,
} from './transcribe';
import {
	getFile,
	getS3Client,
} from '@guardian/transcription-service-common/src/s3';
import path from 'path';

const main = async () => {
	try {
		const config = await getConfig();

		const numberOfThreads = config.app.stage === 'PROD' ? 16 : 2;

		const client = getClient(config.aws.region, config.aws.localstackEndpoint);
		const message = await getNextMessage(client, config.app.taskQueueUrl);
		const snsClient = getSNSClient(
			config.aws.region,
			config.aws.localstackEndpoint,
		);

		if (isFailure(message)) {
			console.error(`Failed to fetch message due to ${message.errorMsg}`);
			return;
		}

		if (!message.message) {
			console.log('No messages available');
			return;
		}

		const job = parseTranscriptJobMessage(message.message);

		console.log(
			`Fetched transcription job with id ${message.message.MessageId}}`,
			job,
		);

		if (!job) {
			console.error('Failed to parse job message', message);
			return;
		}

		const fileToTranscribe = await getFileFromS3(config, job?.s3Key);

		console.log('file is here');

		// docker container to run ffmpeg and whisper on file
		const containerId = await createContainer(path.parse(fileToTranscribe).dir);

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
