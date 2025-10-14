import {
	generateOutputSignedUrlAndSendMessage,
	getConfig,
	getSignedDownloadUrl,
	getSQSClient,
	isSqsFailure,
	logger,
	mediaKey,
	sendMessage,
	TranscriptionConfig,
	uploadObjectWithPresignedUrl,
} from '@guardian/transcription-service-backend-common';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { downloadMedia, startProxyTunnel } from './yt-dlp';
import { MediaMetadata, UrlJob } from '@guardian/transcription-service-common';

import { SQSClient } from '@aws-sdk/client-sqs';
import {
	DestinationService,
	ExternalUrlJob,
	ExternalJobOutput,
	isExternalMediaDownloadJob,
	isTranscriptionMediaDownloadJob,
	MediaDownloadFailure,
	TranscriptionMediaDownloadJob,
} from '@guardian/transcription-service-common';

// This needs to be kept in sync with CDK downloadVolume
export const ECS_MEDIA_DOWNLOAD_WORKING_DIRECTORY = '/media-download';

const uploadToS3 = async (
	s3Client: S3Client,
	metadata: MediaMetadata,
	bucket: string,
	id: string,
) => {
	const fileStream = createReadStream(`${metadata.mediaPath}`);
	const key = mediaKey(id);
	try {
		const upload = new Upload({
			client: s3Client,
			params: {
				Bucket: bucket,
				Key: key,
				Body: fileStream,
				Metadata: {
					extension: metadata.extension,
				},
			},
		});

		upload.on('httpUploadProgress', (progress) => {
			logger.info(`Uploaded ${progress.loaded} of ${progress.total} bytes`);
		});

		await upload.done();
		return key;
	} catch (e) {
		logger.error('Error uploading to S3', e);
		throw e;
	}
};

const reportDownloadFailure = async (
	config: TranscriptionConfig,
	sqsClient: SQSClient,
	job: TranscriptionMediaDownloadJob,
) => {
	const mediaDownloadFailure: MediaDownloadFailure = {
		id: job.id,
		status: 'MEDIA_DOWNLOAD_FAILURE',
		url: job.url,
		userEmail: job.userEmail,
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

const reportExternalFailure = async (
	job: ExternalUrlJob,
	sqsClient: SQSClient,
) => {
	const output: ExternalJobOutput = {
		id: job.id,
		status: 'FAILURE',
		outputType: 'MEDIA_DOWNLOAD',
	};
	await sendMessage(
		sqsClient,
		job.outputQueueUrl,
		JSON.stringify(output),
		job.id,
	);
};

const reportExternalJob = async (
	job: ExternalUrlJob,
	sqsClient: SQSClient,
	metadata: MediaMetadata,
) => {
	const output: ExternalJobOutput = {
		id: job.id,
		status: 'SUCCESS',
		outputType: 'MEDIA_DOWNLOAD',
		metadata,
	};
	await sendMessage(
		sqsClient,
		job.outputQueueUrl,
		JSON.stringify(output),
		job.id,
	);
};

const requestTranscription = async (
	config: TranscriptionConfig,
	s3Key: string,
	sqsClient: SQSClient,
	job: TranscriptionMediaDownloadJob,
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
		config,
		job.userEmail,
		`${metadata.title}.${metadata.extension}`,
		signedUrl,
		job.languageCode,
		job.translationRequested,
		job.diarizationRequested,
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

	const parsedInput = JSON.parse(input);
	const parsedJob = UrlJob.safeParse(parsedInput);
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

	const workingDirectory =
		config.app.stage === 'DEV' ? '/tmp' : ECS_MEDIA_DOWNLOAD_WORKING_DIRECTORY;

	const proxyUrl = useProxy
		? await startProxyTunnel(
				await config.app.mediaDownloadProxySSHKey(),
				config.app.mediaDownloadProxyIpAddress,
				config.app.mediaDownloadProxyPort,
				workingDirectory,
			)
		: undefined;

	const metadata = await downloadMedia(
		job.url,
		workingDirectory,
		job.id,
		proxyUrl,
	);
	if (!metadata) {
		if (isTranscriptionMediaDownloadJob(job)) {
			const tJob = TranscriptionMediaDownloadJob.parse(parsedInput);
			await reportDownloadFailure(config, sqsClient, tJob);
		} else if (isExternalMediaDownloadJob(job)) {
			const eJob = ExternalUrlJob.parse(parsedInput);
			await reportExternalFailure(eJob, sqsClient);
		}
	} else {
		if (isTranscriptionMediaDownloadJob(job)) {
			const tJob = TranscriptionMediaDownloadJob.parse(parsedInput);
			const key = await uploadToS3(
				s3Client,
				metadata,
				config.app.sourceMediaBucket,
				tJob.id,
			);
			await requestTranscription(config, key, sqsClient, tJob, metadata);
		} else if (isExternalMediaDownloadJob(job)) {
			const eJob = ExternalUrlJob.parse(parsedInput);
			await uploadObjectWithPresignedUrl(
				eJob.mediaDownloadOutputSignedUrl,
				metadata.mediaPath,
			);
			await reportExternalJob(eJob, sqsClient, metadata);
		}
	}
};

main();
