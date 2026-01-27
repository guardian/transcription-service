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
	getYtDlpMetricDimension,
	isFailure,
	ProxyData,
	startProxyTunnels,
	isSuccess,
	YtDlpFailure,
	YtDlpSuccess,
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
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

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
		config.aws,
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

// We store success/bot block youtube events to indicate the likelihood of future
// youtube jobs succeeding
const updateYoutubeEvent = async (
	youtubeEventId: string,
	client: DynamoDBDocumentClient,
	tableName: string,
	result: YtDlpSuccess | YtDlpFailure,
) => {
	const statusOrErrorType = isSuccess(result)
		? result.status
		: result.errorType;
	if (statusOrErrorType === 'SUCCESS' || statusOrErrorType === 'BOT_BLOCKED') {
		const youtubeEvent = {
			id: youtubeEventId,
			eventTime: `${new Date().toISOString()}`,
			status: statusOrErrorType,
		};
		await writeDynamoItem(client, tableName, youtubeEvent);
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
		config.aws,
		'media-download',
	);

	const dynamoClient = getDynamoClient(
		config.aws,
		config.dev?.localstackEndpoint,
	);

	const s3Client = new S3Client(config.aws);
	const sqsClient = getSQSClient(config.aws, config.dev?.localstackEndpoint);

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
		: [];

	const parsedUrl = new URL(job.url);
	const isYoutube = parsedUrl.hostname === 'www.youtube.com';

	const ytDlpResult = await downloadMediaWithRetry(
		job.url,
		workingDirectory,
		job.id,
		isYoutube,
		proxyUrls,
		config.app.mediaDownloadCookies,
	);

	const { result, failures } = ytDlpResult;

	logger.info(
		`Finished download attempts with yt-dlp. Final status: ${result.status}, failures: ${failures.join(', ')}`,
	);

	await metrics.putMetric(mediaDownloadJobMetric, [
		{
			Name: 'status',
			Value: getYtDlpMetricDimension(ytDlpResult),
		},
	]);

	if (isYoutube) {
		await updateYoutubeEvent(
			config.app.youtubeEventId,
			dynamoClient,
			config.app.eventsTableName,
			result,
		);
	}

	if (isFailure(result)) {
		if (isTranscriptionMediaDownloadJob(job)) {
			const tJob = TranscriptionMediaDownloadJob.parse(parsedInput);
			await reportDownloadFailure(config, sqsClient, tJob, result.errorType);
		} else if (isExternalMediaDownloadJob(job)) {
			const externalJob = ExternalUrlJob.parse(parsedInput);
			await reportExternalFailure(externalJob, sqsClient, result.errorType);
		}
	} else {
		if (isTranscriptionMediaDownloadJob(job)) {
			const tJob = TranscriptionMediaDownloadJob.parse(parsedInput);
			const key = await uploadToS3(
				s3Client,
				result.metadata,
				config.app.sourceMediaBucket,
				tJob.id,
			);
			await requestTranscription(config, key, sqsClient, tJob, result.metadata);
		} else if (isExternalMediaDownloadJob(job)) {
			const externalJob = ExternalUrlJob.parse(parsedInput);
			await uploadObjectWithPresignedUrl(
				externalJob.mediaDownloadOutputSignedUrl,
				result.metadata.mediaPath,
			);
			await reportExternalJob(externalJob, sqsClient, result.metadata);
		}
	}
};

main();
