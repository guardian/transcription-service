import {
	deleteMessage,
	generateOutputSignedUrlAndSendMessage,
	getConfig,
	getSignedDownloadUrl,
	getSQSClient,
	isSqsFailure,
	logger,
	sendMessage,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { getNextJob } from './sqs';
import { downloadMedia, MediaMetadata } from './yt-dlp';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
	DestinationService,
	MediaDownloadFailure,
	MediaDownloadJob,
} from '@guardian/transcription-service-common';

const uploadToS3 = async (
	s3Client: S3Client,
	metadata: MediaMetadata,
	bucket: string,
	id: string,
) => {
	const fileStream = createReadStream(`${metadata.mediaPath}`);
	const key = `downloaded-media/${id}.${metadata.extension}`;
	try {
		const upload = new Upload({
			client: s3Client,
			params: {
				Bucket: bucket,
				Key: `downloaded-media/${metadata.title}.${metadata.extension}`,
				Body: fileStream,
			},
		});

		upload.on('httpUploadProgress', (progress) => {
			console.log(`Uploaded ${progress.loaded} of ${progress.total} bytes`);
		});

		await upload.done();
		return key;
	} catch (e) {
		console.error(e);
		throw e;
	}
};

const reportDownloadFailure = async (
	config: TranscriptionConfig,
	sqsClient: SQSClient,
	job: MediaDownloadJob,
) => {
	const mediaDownloadFailure: MediaDownloadFailure = {
		id: job.id,
		status: 'FAILURE',
		url: job.url,
	};
	const result = await sendMessage(
		sqsClient,
		config.app.destinationQueueUrls[DestinationService.TranscriptionService],
		JSON.stringify(mediaDownloadFailure),
		job.id,
	);
	if (isSqsFailure(result)) {
		logger.error('Failed to send download failure message', result.error);
		throw new Error('Failed to send failure message');
	}
};

const requestTranscription = async (
	config: TranscriptionConfig,
	s3Key: string,
	sqsClient: SQSClient,
	job: MediaDownloadJob,
	metadata: MediaMetadata,
) => {
	const signedUrl = await getSignedDownloadUrl(
		config.aws.region,
		config.app.sourceMediaBucket,
		s3Key,
		604800, // one week in seconds
	);
	const sendResult = await generateOutputSignedUrlAndSendMessage(
		s3Key,
		sqsClient,
		config.app.taskQueueUrl,
		config.app.transcriptionOutputBucket,
		config.aws.region,
		job.userEmail,
		metadata.title,
		signedUrl,
		job.languageCode,
		job.translationRequested,
	);
	if (isSqsFailure(sendResult)) {
		throw new Error('Failed to send transcription job');
	}
};

const main = async () => {
	console.log('Starting media download service');
	console.log(`INPUT: ${process.env.MESSAGE_BODY}`);
	const config = await getConfig();

	const s3Client = new S3Client({ region: config.aws.region });
	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);
	const jobResult = await getNextJob(
		sqsClient,
		config.app.mediaDownloadQueueUrl,
		config.app.stage === 'DEV',
	);
	if (jobResult && jobResult.job) {
		const { job, receiptHandle } = jobResult;
		const metadata = await downloadMedia(job.url, '/tmp', job.id);
		if (!metadata) {
			await reportDownloadFailure(config, sqsClient, job);
		} else {
			const key = await uploadToS3(
				s3Client,
				metadata,
				config.app.sourceMediaBucket,
				job.id,
			);
			await requestTranscription(config, key, sqsClient, job, metadata);
		}
		if (receiptHandle) {
			await deleteMessage(
				sqsClient,
				config.app.mediaDownloadQueueUrl,
				receiptHandle,
			);
		}
	}
	setTimeout(main, 1000);
};

main();
