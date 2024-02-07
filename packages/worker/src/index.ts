import {
	getConfig,
	getClient,
	getNextMessage,
	parseTranscriptJobMessage,
	isFailure,
	deleteMessage,
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
	const config = await getConfig();

	const client = getClient(config.aws.region, config.aws.localstackEndpoint);
	const message = await getNextMessage(client, config.app.taskQueueUrl);
	const snsClient = getSNSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);
	if (isFailure(message) || !message.message) {
		console.log('Failed to fetch message or no messages available');
		return;
	}

	const job = parseTranscriptJobMessage(message.message);
	console.log(
		`Fetched transcription job with id ${message.message.MessageId}}`,
		job,
	);
	if (!job) {
		console.error('Failed to parse message', message);
		return;
	}
	const s3Client = getS3Client(config.aws.region);

	const fileToTranscribe = await getFile(
		s3Client,
		config.app.sourceMediaBucket,
		job?.s3Key,
		config.app.stage === 'DEV' ? `${__dirname}/sample` : '/tmp',
	);

	const containerId = await createContainer(path.parse(fileToTranscribe).dir);
	const ffmpegResult = await convertToWav(containerId, fileToTranscribe);

	const text = await getTranscriptionText(
		containerId,
		ffmpegResult.wavPath,
		fileToTranscribe,
	);
	console.log(text);

	await publishTranscriptionOutput(
		snsClient,
		config.app.destinationTopicArns.transcriptionService,
		{
			id: 'test-id',
			transcriptionSrt: text,
			languageCode: 'en',
			userEmail: 'test@test.com',
		},
	);

	if (message.message?.ReceiptHandle) {
		console.log(`Deleting message ${message.message?.MessageId}`);
		await deleteMessage(
			client,
			config.app.taskQueueUrl,
			message.message.ReceiptHandle,
		);
	}
};

main();
