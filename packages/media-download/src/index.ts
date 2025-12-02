import {
	generateOutputSignedUrlAndSendMessage,
	getConfig,
	getDynamoClient,
	getSignedDownloadUrl,
	getSQSClient,
	isSqsFailure,
	logger,
	mediaKey,
	sendMessage,
	TranscriptionConfig,
	uploadObjectWithPresignedUrl,
	writeDynamoItem,
} from '@guardian/transcription-service-backend-common';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import {
	downloadMediaWithRetry,
	getYoutubeEvent,
	isFailure,
	ProxyData,
	startProxyTunnels,
} from './yt-dlp';
import {
	MediaDownloadFailureReason,
	MediaMetadata,
	UrlJob,
} from '@guardian/transcription-service-common';

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
import {
	mediaDownloadJobMetric,
	MetricsService,
} from '@guardian/transcription-service-backend-common/src/metrics';

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
	failureReason: MediaDownloadFailureReason,
) => {
	const mediaDownloadFailure: MediaDownloadFailure = {
		id: job.id,
		status: 'MEDIA_DOWNLOAD_FAILURE',
		failureReason: failureReason,
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
	errorType: MediaDownloadFailureReason,
) => {
	const output: ExternalJobOutput = {
		id: job.id,
		taskId: job.mediaDownloadId,
		status: errorType,
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
		taskId: job.mediaDownloadId,
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
			`MESSAGE_BODY is not a valid UrlJob - exiting. MESSAGE_BODY: ${input} Errors: ${parsedJob.error.errors.map((e) => e.message).join(', ')}`,
		);
		return;
	}
	const job = parsedJob.data;

	const config = await getConfig();

	const metrics = new MetricsService(
		config.app.stage,
		config.aws.region,
		'media-download',
	);

	const dynamoClient = getDynamoClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);

	const s3Client = new S3Client({ region: config.aws.region });
	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);

	const useProxy =
		config.app.stage !== 'DEV' || process.env['USE_PROXY'] === 'true';

	const workingDirectory =
		config.app.stage === 'DEV' ? '/tmp' : ECS_MEDIA_DOWNLOAD_WORKING_DIRECTORY;

	const proxyData: ProxyData[] = config.app.mediaDownloadProxyIpAddresses.map(
		(ip, index) => ({
			ip: ip,
			port: config.app.mediaDownloadProxyPort + index,
		}),
	);

	const proxyUrls = useProxy
		? await startProxyTunnels(
				await config.app.mediaDownloadProxySSHKey(),
				proxyData,
				workingDirectory,
			)
		: undefined;

	const ytDlpResult = await downloadMediaWithRetry(
		job.url,
		workingDirectory,
		job.id,
		config.app.mediaDownloadCookies,
		proxyUrls,
	);

	const successOrErrorType = isFailure(ytDlpResult)
		? ytDlpResult.errorType
		: ytDlpResult.status;
	await metrics.putMetric(mediaDownloadJobMetric, [
		{
			Name: 'status',
			Value: successOrErrorType,
		},
	]);

	const youtubeEvent = getYoutubeEvent(
		job.url,
		successOrErrorType,
		config.app.youtubeEventId,
	);
	if (youtubeEvent) {
		await writeDynamoItem(
			dynamoClient,
			config.app.eventsTableName,
			youtubeEvent,
		);
	}

	if (isFailure(ytDlpResult)) {
		if (isTranscriptionMediaDownloadJob(job)) {
			const tJob = TranscriptionMediaDownloadJob.parse(parsedInput);
			await reportDownloadFailure(
				config,
				sqsClient,
				tJob,
				ytDlpResult.errorType,
			);
		} else if (isExternalMediaDownloadJob(job)) {
			const externalJob = ExternalUrlJob.parse(parsedInput);
			await reportExternalFailure(
				externalJob,
				sqsClient,
				ytDlpResult.errorType,
			);
		}
	} else {
		if (isTranscriptionMediaDownloadJob(job)) {
			const tJob = TranscriptionMediaDownloadJob.parse(parsedInput);
			const key = await uploadToS3(
				s3Client,
				ytDlpResult.metadata,
				config.app.sourceMediaBucket,
				tJob.id,
			);
			await requestTranscription(
				config,
				key,
				sqsClient,
				tJob,
				ytDlpResult.metadata,
			);
		} else if (isExternalMediaDownloadJob(job)) {
			const externalJob = ExternalUrlJob.parse(parsedInput);
			await uploadObjectWithPresignedUrl(
				externalJob.mediaDownloadOutputSignedUrl,
				ytDlpResult.metadata.mediaPath,
			);
			await reportExternalJob(externalJob, sqsClient, ytDlpResult.metadata);
		}
	}
};

main();
