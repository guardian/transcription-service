import {
	getConfig,
	getSQSClient,
	getNextMessage,
	parseTranscriptJobMessage,
	isSqsFailure,
	deleteMessage,
	changeMessageVisibility,
	getObjectWithPresignedUrl,
	TranscriptionConfig,
	moveMessageToDeadLetterQueue,
	logger,
	publishTranscriptionOutput,
	readFile,
	getASGClient,
} from '@guardian/transcription-service-backend-common';
import {
	OutputBucketKeys,
	TranscriptionJob,
	TranscriptionOutputFailure,
	type TranscriptionOutputSuccess,
} from '@guardian/transcription-service-common';
import {
	getTranscriptionText,
	convertToWav,
	getOrCreateContainer,
} from './transcribe';
import path from 'path';

import { getInstanceLifecycleState, updateScaleInProtection } from './asg';
import { uploadAllTranscriptsToS3 } from './util';
import {
	MetricsService,
	FailureMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { SQSClient } from '@aws-sdk/client-sqs';
import { setTimeout } from 'timers/promises';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common';
import { checkSpotInterrupt } from './spot-termination';
import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';

const POLLING_INTERVAL_SECONDS = 30;

// Mutable variable is needed here to get feedback from checkSpotInterrupt
let INTERRUPTION_TIME: Date | undefined = undefined;
let CURRENT_MESSAGE_RECEIPT_HANDLE: string | undefined = undefined;
export const setInterruptionTime = (time: Date) => (INTERRUPTION_TIME = time);
export const getCurrentReceiptHandle = () => CURRENT_MESSAGE_RECEIPT_HANDLE;

const main = async () => {
	const config = await getConfig();
	const instanceId =
		config.app.stage === 'DEV'
			? ''
			: readFile('/var/lib/cloud/data/instance-id').trim();

	const metrics = new MetricsService(
		config.app.stage,
		config.aws.region,
		'worker',
	);

	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);

	const autoScalingClient = getASGClient(config.aws.region);

	if (config.app.stage !== 'DEV') {
		// start job to regularly check the instance interruption (Note: deliberately not using await here so the job
		// runs in the background)
		checkSpotInterrupt(sqsClient, config.app.taskQueueUrl);
	}

	let pollCount = 0;
	// keep polling unless instance is scheduled for termination
	while (!INTERRUPTION_TIME) {
		pollCount += 1;
		const lifecycleState = await getInstanceLifecycleState(
			autoScalingClient,
			config.app.stage,
			instanceId,
		);
		if (config.app.stage === 'DEV' || lifecycleState === 'InService') {
			await pollTranscriptionQueue(
				pollCount,
				sqsClient,
				autoScalingClient,
				metrics,
				config,
				instanceId,
			);
		} else {
			logger.warn(
				`instance in state ${lifecycleState} - waiting until it goes to InService.`,
			);
		}
		await setTimeout(POLLING_INTERVAL_SECONDS * 1000);
	}
};

const publishTranscriptionOutputFailure = async (
	sqsClient: SQSClient,
	destination: string,
	job: TranscriptionJob,
) => {
	logger.info('publishing transcription output failed');
	const failureMessage: TranscriptionOutputFailure = {
		id: job.id,
		status: 'FAILURE',
		userEmail: job.userEmail,
		originalFilename: job.originalFilename,
		isTranslation: job.translate,
	};
	try {
		await publishTranscriptionOutput(sqsClient, destination, failureMessage);
	} catch (e) {
		logger.error('error publishing transcription output failed', e);
	}
};

const pollTranscriptionQueue = async (
	pollCount: number,
	sqsClient: SQSClient,
	autoScalingClient: AutoScalingClient,
	metrics: MetricsService,
	config: TranscriptionConfig,
	instanceId: string,
) => {
	const stage = config.app.stage;
	const numberOfThreads = config.app.stage === 'PROD' ? 16 : 2;
	const isDev = config.app.stage === 'DEV';

	logger.info(
		`worker polling for transcription task. Poll count = ${pollCount}`,
	);

	await updateScaleInProtection(autoScalingClient, stage, true, instanceId);

	const message = await getNextMessage(sqsClient, config.app.taskQueueUrl);

	if (isSqsFailure(message)) {
		logger.error(`Failed to fetch message due to ${message.errorMsg}`);
		await updateScaleInProtection(autoScalingClient, stage, false, instanceId);
		return;
	}

	if (!message.message) {
		logger.info('No messages available');
		await updateScaleInProtection(autoScalingClient, stage, false, instanceId);
		return;
	}

	const taskMessage = message.message;
	if (!taskMessage.Body) {
		logger.error('message missing body');
		await updateScaleInProtection(autoScalingClient, stage, false, instanceId);
		return;
	}
	if (!taskMessage.Attributes && !isDev) {
		logger.error('message missing attributes');
		await updateScaleInProtection(autoScalingClient, stage, false, instanceId);
		return;
	}

	const receiptHandle = taskMessage.ReceiptHandle;
	if (!receiptHandle) {
		logger.error('message missing receipt handle');
		await updateScaleInProtection(autoScalingClient, stage, false, instanceId);
		return;
	}
	CURRENT_MESSAGE_RECEIPT_HANDLE = receiptHandle;

	const job = parseTranscriptJobMessage(taskMessage);

	if (!job) {
		await metrics.putMetric(FailureMetric);
		logger.error('Failed to parse job message', message);
		await updateScaleInProtection(autoScalingClient, stage, false, instanceId);
		return;
	}

	try {
		// from this point all worker logs will have id & userEmail in their fields
		logger.setCommonMetadata(job.id, job.userEmail);

		const { outputBucketUrls, inputSignedUrl } = job;

		logger.info(`Fetched transcription job with id ${job.id}`);

		const destinationDirectory = isDev ? `${__dirname}/sample` : '/tmp';

		const fileToTranscribe = await getObjectWithPresignedUrl(
			inputSignedUrl,
			job.id,
			destinationDirectory,
		);

		// docker container to run ffmpeg and whisper on file
		const containerId = await getOrCreateContainer(
			path.parse(fileToTranscribe).dir,
		);

		const ffmpegResult = await convertToWav(containerId, fileToTranscribe);
		if (ffmpegResult === undefined) {
			// when ffmpeg fails to transcribe, move message to the dead letter
			// queue
			if (!isDev && config.app.deadLetterQueueUrl) {
				logger.error(
					`'ffmpeg failed, moving message with message id ${taskMessage.MessageId} to dead letter queue`,
				);
				await moveMessageToDeadLetterQueue(
					sqsClient,
					config.app.taskQueueUrl,
					config.app.deadLetterQueueUrl,
					taskMessage.Body,
					receiptHandle,
					job.id,
				);
				logger.info(
					`moved message with message id ${taskMessage.MessageId} to dead letter queue.`,
				);
			} else {
				logger.info('skip moving message to dead letter queue in DEV');
			}
			await publishTranscriptionOutputFailure(
				sqsClient,
				config.app.destinationQueueUrls[job.transcriptDestinationService],
				job,
			);
			return;
		}

		if (ffmpegResult.duration && ffmpegResult.duration !== 0) {
			// Transcription time is usually slightly longer than file duration.
			// Update visibility timeout to 2x the file duration plus 10 minutes for the model to load.
			// This should avoid another worker picking up the task and to allow
			// this worker to delete the message when it's finished.
			await changeMessageVisibility(
				sqsClient,
				config.app.taskQueueUrl,
				receiptHandle,
				ffmpegResult.duration * 2 + 600,
			);
		}

		const transcriptResult = await getTranscriptionText(
			containerId,
			ffmpegResult.wavPath,
			fileToTranscribe,
			numberOfThreads,
			config.app.stage === 'PROD' ? 'medium' : 'tiny',
			job.languageCode,
			job.translate,
		);

		// if we've received an interrupt signal we don't want to perform a half-finished transcript upload/publish as
		// this may, for example, result in duplicate emails to the user. Here we assume that we can upload some text
		// files to s3 and make a single request to SNS and SQS within 20 seconds
		if (
			INTERRUPTION_TIME &&
			INTERRUPTION_TIME.getTime() - new Date().getTime() < 20 * 1000
		) {
			logger.warn('Spot termination happening soon, abandoning transcription');
			// exit cleanly to prevent systemd restarting the process
			process.exit(0);
		}

		await uploadAllTranscriptsToS3(
			outputBucketUrls,
			transcriptResult.transcripts,
		);

		const outputBucketKeys: OutputBucketKeys = {
			srt: outputBucketUrls.srt.key,
			json: outputBucketUrls.json.key,
			text: outputBucketUrls.text.key,
		};

		const transcriptionOutput: TranscriptionOutputSuccess = {
			id: job.id,
			status: 'SUCCESS',
			languageCode:
				job.languageCode === 'auto'
					? transcriptResult.metadata.detectedLanguageCode || 'UNKNOWN'
					: job.languageCode,
			userEmail: job.userEmail,
			originalFilename: job.originalFilename,
			outputBucketKeys,
			isTranslation: job.translate,
		};

		await publishTranscriptionOutput(
			sqsClient,
			config.app.destinationQueueUrls[job.transcriptDestinationService],
			transcriptionOutput,
		);

		logger.info(
			'Worker successfully transcribed the file and sent notification to sns',
			{
				id: transcriptionOutput.id,
				filename: transcriptionOutput.originalFilename,
				userEmail: transcriptionOutput.userEmail,
				mediaDurationSeconds: ffmpegResult.duration || 0,
				specifiedLanguageCode: job.languageCode,
				...transcriptResult.metadata,
			},
		);

		logger.info(`Deleting message ${taskMessage.MessageId}`);
		await deleteMessage(sqsClient, config.app.taskQueueUrl, receiptHandle);
	} catch (error) {
		const msg = 'Worker failed to complete';
		logger.error(msg, error);
		// Terminate the message visibility timeout
		await changeMessageVisibility(
			sqsClient,
			config.app.taskQueueUrl,
			receiptHandle,
			0,
		);

		// the type of ApproximateReceiveCount is string | undefined so need to
		// handle the case where its missing. use default value
		// MAX_RECEIVE_COUNT since its probably better to send too many failure
		// messages than to not send any.
		const defaultReceiveCount = MAX_RECEIVE_COUNT.toString();
		const receiveCount = parseInt(
			taskMessage.Attributes?.ApproximateReceiveCount || defaultReceiveCount,
		);
		if (receiveCount >= MAX_RECEIVE_COUNT) {
			await publishTranscriptionOutputFailure(
				sqsClient,
				config.app.destinationQueueUrls[job.transcriptDestinationService],
				job,
			);
		}
	} finally {
		logger.resetCommonMetadata();
		await updateScaleInProtection(autoScalingClient, stage, false, instanceId);
	}
};

main();
