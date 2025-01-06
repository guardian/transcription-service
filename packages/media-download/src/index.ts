import {
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
import { downloadMedia, MediaMetadata, startProxyTunnel } from './yt-dlp';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
	DestinationService,
	MediaDownloadFailure,
	MediaDownloadJob,
} from '@guardian/transcription-service-common';

export const MEDIA_DOWNLOAD_WORKING_DIRECTORY = '/media-download';

const uploadToS3 = async (
	s3Client: S3Client,
	metadata: MediaMetadata,
	bucket: string,
	id: string,
) => {
	const fileStream = createReadStream(`${metadata.mediaPath}`);
	const key = `downloaded-media/${id}`;
	try {
		const upload = new Upload({
			client: s3Client,
			params: {
				Bucket: bucket,
				Key: key,
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
		status: 'MEDIA_DOWNLOAD_FAILURE',
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
	logger.info('Starting media download service');
	const input = process.env.MESSAGE_BODY;
	if (!input) {
		logger.error(
			'MESSAGE_BODY not set - exiting. If running locally you can use the ./scripts/trigger-media-download-service.sh script to set MESSAGE_BODY',
		);
		return;
	}

	const parsedJob = MediaDownloadJob.safeParse(JSON.parse(input));
	if (!parsedJob.success) {
		logger.error(
			`MESSAGE_BODY is not a valid MediaDownloadJob - exiting. MESSAGE_BODY: ${input} Errors: ${parsedJob.error.errors.map((e) => e.message).join(', ')}`,
		);
		return;
	}
	const job = parsedJob.data;

	const config = await getConfig();

	const s3Client = new S3Client({ region: config.aws.region });
	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);

	const useProxy =
		config.app.stage !== 'DEV' || process.env['USE_PROXY'] === 'true';

	const proxyUrl = useProxy
		? await startProxyTunnel(
				await config.app.mediaDownloadProxySSHKey(),
				config.app.mediaDownloadProxyIpAddress,
				config.app.mediaDownloadProxyPort,
			)
		: undefined;

	const metadata = await downloadMedia(
		job.url,
		MEDIA_DOWNLOAD_WORKING_DIRECTORY,
		job.id,
		proxyUrl,
	);
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
};

main();
