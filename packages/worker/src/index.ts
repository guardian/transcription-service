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
	logger,
	publishTranscriptionOutput,
	readFile,
	getASGClient,
} from '@guardian/transcription-service-backend-common';
import {
	OutputLanguageCode,
	TranscriptionEngine,
	type TranscriptionOutputSuccess,
} from '@guardian/transcription-service-common';
import { whisperTranscription, getParakeetTranscription } from './transcribe';

import { getInstanceLifecycleState, updateScaleInProtection } from './asg';
import { uploadedCombinedResultsToS3 } from './util';
import {
	MetricsService,
	FailureMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { SQSClient } from '@aws-sdk/client-sqs';
import { setTimeout } from 'timers/promises';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common';
import { checkSpotInterrupt } from './spot-termination';
import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';
import { getFileDuration } from '@guardian/transcription-service-backend-common/src/ffmpeg';
import { publishTranscriptionOutputFailure } from './sqs';

const POLLING_INTERVAL_SECONDS = 15;

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
	const isGpu = config.app.app.startsWith('transcription-service-gpu-worker');
	const asgName = isGpu
		? `transcription-service-gpu-workers-${config.app.stage}`
		: `transcription-service-workers-${config.app.stage}`;
	const queueUrl = isGpu ? config.app.gpuTaskQueueUrl : config.app.taskQueueUrl;

	logger.info(`Worker reading from queue ${queueUrl}`);

	if (config.app.stage !== 'DEV') {
		// start job to regularly check the instance interruption (Note: deliberately not using await here so the job
		// runs in the background)
		checkSpotInterrupt(sqsClient, queueUrl);
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
				queueUrl,
				autoScalingClient,
				asgName,
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

const pollTranscriptionQueue = async (
	pollCount: number,
	sqsClient: SQSClient,
	taskQueueUrl: string,
	autoScalingClient: AutoScalingClient,
	asgName: string,
	metrics: MetricsService,
	config: TranscriptionConfig,
	instanceId: string,
) => {
	const stage = config.app.stage;

	const isDev = config.app.stage === 'DEV';

	logger.info(
		`worker polling ${taskQueueUrl} for transcription task. Poll count = ${pollCount}`,
	);

	await updateScaleInProtection(
		autoScalingClient,
		stage,
		true,
		instanceId,
		asgName,
	);

	const message = await getNextMessage(sqsClient, taskQueueUrl);

	if (isSqsFailure(message)) {
		logger.error(`Failed to fetch message due to ${message.errorMsg}`);
		await updateScaleInProtection(
			autoScalingClient,
			stage,
			false,
			instanceId,
			asgName,
		);
		return;
	}

	if (!message.message) {
		logger.info('No messages available');
		await updateScaleInProtection(
			autoScalingClient,
			stage,
			false,
			instanceId,
			asgName,
		);
		return;
	}

	const taskMessage = message.message;
	if (!taskMessage.Body) {
		logger.error('message missing body');
		await updateScaleInProtection(
			autoScalingClient,
			stage,
			false,
			instanceId,
			asgName,
		);
		return;
	}
	if (!taskMessage.Attributes && !isDev) {
		logger.error('message missing attributes');
		await updateScaleInProtection(
			autoScalingClient,
			stage,
			false,
			instanceId,
			asgName,
		);
		return;
	}

	const receiptHandle = taskMessage.ReceiptHandle;
	if (!receiptHandle) {
		logger.error('message missing receipt handle');
		await updateScaleInProtection(
			autoScalingClient,
			stage,
			false,
			instanceId,
			asgName,
		);
		return;
	}
	CURRENT_MESSAGE_RECEIPT_HANDLE = receiptHandle;

	const job = parseTranscriptJobMessage(taskMessage);

	if (!job) {
		await metrics.putMetric(FailureMetric);
		logger.error('Failed to parse job message', message);
		await updateScaleInProtection(
			autoScalingClient,
			stage,
			false,
			instanceId,
			asgName,
		);
		return;
	}

	try {
		// from this point all worker logs will have id & userEmail in their fields
		logger.setCommonMetadata(job.id, job.userEmail);

		const { inputSignedUrl, combinedOutputUrl } = job;

		logger.info(
			`Fetched transcription job with id ${job.id}, engine ${job.engine}`,
		);

		const destinationDirectory = isDev
			? `${__dirname}/../../../worker-tmp-files`
			: '/tmp';

		const fileToTranscribe = await getObjectWithPresignedUrl(
			inputSignedUrl,
			job.id,
			destinationDirectory,
		);

		const fileDuration = await getFileDuration(fileToTranscribe);

		const transcriptionStartTime = new Date();
		const transcriptResult =
			job.engine === TranscriptionEngine.PARAKEET
				? await getParakeetTranscription({
						mediaPath: fileToTranscribe,
					})
				: await whisperTranscription(
						job,
						config,
						destinationDirectory,
						fileToTranscribe,
						sqsClient,
						taskQueueUrl,
						taskMessage,
						receiptHandle,
					);

		if (transcriptResult === null) {
			await publishTranscriptionOutputFailure(
				sqsClient,
				config.app.destinationQueueUrls[job.transcriptDestinationService],
				job,
			);
			return;
		}

		const languageCode: OutputLanguageCode =
			job.languageCode === 'auto'
				? transcriptResult.metadata.detectedLanguageCode
				: job.languageCode;
		const transcriptionEndTime = new Date();
		const transcriptionTimeSeconds = Math.round(
			(transcriptionEndTime.getTime() - transcriptionStartTime.getTime()) /
				1000,
		);
		const transcriptionRate =
			fileDuration && fileDuration / transcriptionTimeSeconds;
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

		await uploadedCombinedResultsToS3(combinedOutputUrl.url, transcriptResult);

		const transcriptionOutput: TranscriptionOutputSuccess = {
			id: job.id,
			status: 'SUCCESS',
			languageCode,
			userEmail: job.userEmail,
			originalFilename: job.originalFilename,
			combinedOutputKey: combinedOutputUrl?.key,
			isTranslation: job.translate,
			duration: fileDuration,
			engine: job.engine,
		};

		await publishTranscriptionOutput(
			sqsClient,
			config.app.destinationQueueUrls[job.transcriptDestinationService],
			transcriptionOutput,
		);

		logger.info(
			`Worker successfully transcribed the file and sent notification to ${job.transcriptDestinationService} output queue`,
			{
				id: transcriptionOutput.id,
				filename: transcriptionOutput.originalFilename,
				userEmail: transcriptionOutput.userEmail,
				mediaDurationSeconds: fileDuration || 0,
				transcriptionTimeSeconds,
				transcriptionRate: transcriptionRate || '',
				engine: job.engine,
				specifiedLanguageCode: job.languageCode,
				...transcriptResult.metadata,
			},
		);

		logger.info(`Deleting message ${taskMessage.MessageId}`);
		await deleteMessage(sqsClient, taskQueueUrl, receiptHandle, job.id);
	} catch (error) {
		const msg = 'Worker failed to complete';
		logger.error(msg, error);
		// Terminate the message visibility timeout
		await changeMessageVisibility(sqsClient, taskQueueUrl, receiptHandle, 0);

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
		await updateScaleInProtection(
			autoScalingClient,
			stage,
			false,
			instanceId,
			asgName,
		);
	}
};

main();
