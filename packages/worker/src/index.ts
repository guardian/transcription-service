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
	getS3Client,
} from '@guardian/transcription-service-backend-common';
import { type LLMOutputFailure } from '@guardian/transcription-service-common';

import {
	getInstanceLifecycleState,
	terminateInstance,
	updateScaleInProtection,
} from './asg';
import { processLLMJob } from './llama-cpp';
import {
	MetricsService,
	FailureMetric,
	secondsFromEnqueueToStartMetric,
	attemptNumberMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { SQSClient } from '@aws-sdk/client-sqs';
import { setTimeout } from 'timers/promises';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common';
import { checkSpotInterrupt } from './spot-termination';
import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';
import fs from 'node:fs';
import { newArtifactAvailable } from './s3';
import {
	processTranscriptionJob,
	publishTranscriptionOutputFailure,
} from './transcribe';

const POLLING_INTERVAL_SECONDS = 15;

// Mutable variable is needed here to get feedback from checkSpotInterrupt
let INTERRUPTION_TIME: Date | undefined = undefined;
let CURRENT_MESSAGE_RECEIPT_HANDLE: string | undefined = undefined;
export const setInterruptionTime = (time: Date) => (INTERRUPTION_TIME = time);
export const getCurrentReceiptHandle = () => CURRENT_MESSAGE_RECEIPT_HANDLE;

const main = async () => {
	// This time won't be accurate if the app restarts. I went for this rather than
	// using the EC2 DescribeInstances command to reduce the extra permissions
	// needed, but we could reconsider
	const appStartTime = new Date();

	const config = await getConfig();
	const instanceId =
		config.app.stage === 'DEV'
			? ''
			: readFile('/var/lib/cloud/data/instance-id').trim();
	logger.info(`Retrieved instance id: ${instanceId}`);

	const metrics = new MetricsService(config.app.stage, config.aws, 'worker');

	const sqsClient = getSQSClient(config.aws, config.dev?.localstackEndpoint);
	const s3Client = getS3Client(config.aws);

	const autoScalingClient = getASGClient(config.aws);
	const asgName = `transcription-service-gpu-workers-${config.app.stage}`;
	const queueUrl = config.app.gpuTaskQueueUrl;

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
		const shouldTerminate =
			config.app.stage !== 'DEV' &&
			(await newArtifactAvailable(
				appStartTime,
				s3Client,
				config.app.workerArtifactBucket,
				config.app.workerArtifactKey,
			));
		if (shouldTerminate) {
			logger.info('New worker artifact detected, terminating this instance');
			await terminateInstance(autoScalingClient, instanceId);
			return;
		}
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

	const attemptNumber = parseInt(
		message.message.Attributes?.ApproximateReceiveCount ?? '0',
	);
	await metrics.putMetric(attemptNumberMetric(attemptNumber));

	const maybeSentTimestamp: string | undefined | null =
		message.message.Attributes?.SentTimestamp;
	const maybeEnqueuedAtEpochMillis = maybeSentTimestamp
		? parseInt(maybeSentTimestamp)
		: undefined;
	const messageReceivedAtEpochMillis = Date.now();
	const maybeSecondsFromEnqueueToStartMetric =
		maybeEnqueuedAtEpochMillis &&
		(messageReceivedAtEpochMillis - maybeEnqueuedAtEpochMillis) / 1000;

	if (attemptNumber < 2 && maybeSecondsFromEnqueueToStartMetric) {
		await metrics.putMetric(
			secondsFromEnqueueToStartMetric(maybeSecondsFromEnqueueToStartMetric),
		);
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
		// (plus the attempt number and how long it was in seconds between when the item entered the queue to when it was picked up)
		logger.setCommonMetadata(
			job.id,
			job.userEmail,
			attemptNumber,
			maybeSecondsFromEnqueueToStartMetric,
		);

		const { inputSignedUrl, jobType } = job;

		const destinationDirectory = isDev
			? `${__dirname}/../../../worker-tmp-files`
			: '/tmp';

		fs.mkdirSync(destinationDirectory, { recursive: true });

		const downloadedFile = await getObjectWithPresignedUrl(
			inputSignedUrl,
			job.id,
			destinationDirectory,
		);

		if (jobType === 'llm') {
			await processLLMJob(
				job,
				downloadedFile,
				destinationDirectory,
				sqsClient,
				config,
				taskQueueUrl,
				receiptHandle,
			);
		} else {
			await processTranscriptionJob(
				job,
				downloadedFile,
				destinationDirectory,
				sqsClient,
				config,
				taskQueueUrl,
				receiptHandle,
				isDev,
				metrics,
				taskMessage,
				maybeEnqueuedAtEpochMillis,
				INTERRUPTION_TIME,
			);
		}

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
			if (job.jobType === 'llm') {
				const llmFailure: LLMOutputFailure = {
					id: job.id,
					status: 'LLM_FAILURE',
					userEmail: job.userEmail,
				};
				await publishTranscriptionOutput(
					sqsClient,
					config.app.destinationQueueUrls[job.transcriptDestinationService],
					llmFailure,
				);
			} else {
				await publishTranscriptionOutputFailure(
					sqsClient,
					config.app.destinationQueueUrls[job.transcriptDestinationService],
					job,
				);
			}
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
