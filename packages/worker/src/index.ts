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
import type {
	OutputBucketUrls,
	TranscriptionOutput,
} from '@guardian/transcription-service-common';
import { getSNSClient, publishTranscriptionOutput } from './sns';
import {
	getTranscriptionText,
	convertToWav,
	getOrCreateContainer,
	Transcripts,
} from './transcribe';
import path from 'path';
import { updateScaleInProtection } from './asg';

const main = async () => {
	const config = await getConfig();
	const stage = config.app.stage;
	const region = config.aws.region;

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
			console.error('Failed to parse job message', message);
			return;
		}

		const { outputBucketUrls, ...loggableJob } = job;

		console.log(
			`Fetched transcription job with id ${message.message.MessageId}}`,
			loggableJob,
		);

		const fileToTranscribe = await getFileFromS3(config, job.s3Key);

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
		);

		await uploadAllTranscriptsToS3(outputBucketUrls, transcripts);

		const transcriptionOutput: TranscriptionOutput = {
			id: job.id,
			languageCode: 'en',
			userEmail: job.userEmail,
			originalFilename: job.originalFilename,
			outputBucketUrls,
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
		await updateScaleInProtection(region, stage, false);
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

export const uploadAllTranscriptsToS3 = async (
	destinationBucketUrls: OutputBucketUrls,
	files: Transcripts,
) => {
	const getBlob = (file: string) => new Blob([file as BlobPart]);
	const getFileName = (file: string) => path.basename(file);
	const blobs: [string, string, Blob][] = [
		[getFileName(files.srt), destinationBucketUrls.srt, getBlob(files.srt)],
		[getFileName(files.json), destinationBucketUrls.json, getBlob(files.json)],
		[getFileName(files.text), destinationBucketUrls.text, getBlob(files.text)],
	];

	try {
		for (const blobDetail of blobs) {
			const [fileName, url, blob] = blobDetail;
			const response = await uploadToS3(url, blob);
			if (!response) {
				throw new Error(`Could not upload ${fileName} to S3`);
			}
			console.log(`Successfully uploaded ${fileName} to S3`);
		}
	} catch (error) {
		console.error('failed to upload transcript to S3', error);
	}
};

const uploadToS3 = async (url: string, blob: Blob) => {
	try {
		const response = await fetch(url, {
			method: 'PUT',
			body: blob,
		});
		const status = response.status;
		return status === 200;
	} catch (error) {
		console.error('upload error:', error);
		return false;
	}
};

main();
