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
	getForwardedMessageAttributes,
} from '@guardian/transcription-service-backend-common';
import { type LLMOutputFailure } from '@guardian/transcription-service-common';

import {
	getInstanceLifecycleState,
	terminateInstance,
	updateScaleInProtection,
} from './asg';
import { processLLMOrTranslationJob } from './llama-cpp';
import {
	MetricsService,
	FailureMetric,
	secondsFromEnqueueToStartMetric,
	attemptNumberMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { Message, SQSClient } from '@aws-sdk/client-sqs';
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
import {
	activityTypes,
	buildQueueUrl,
	priorityLevels,
	sensitivityLevels,
} from '@guardian/transcription-service-common/src/queue-gardens';

const POLLING_INTERVAL_SECONDS = 15;

// Mutable variable is needed here to get feedback from checkSpotInterrupt
let INTERRUPTION_TIME: Date | undefined = undefined;
let CURRENT_MESSAGE_RECEIPT_HANDLE: string | undefined = undefined;
let CURRENT_QUEUE_URL: string | null = null;
export const setInterruptionTime = (time: Date) => (INTERRUPTION_TIME = time);
export const getCurrentReceiptHandle = () => CURRENT_MESSAGE_RECEIPT_HANDLE;
export const getCurrentQueueUrl = () => CURRENT_QUEUE_URL;

let maybeCurrentIdleTaskAborter: AbortController | null = null;

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

	if (config.app.stage !== 'DEV') {
		// start job to regularly check the instance interruption (Note: deliberately not using await here so the job
		// runs in the background)
		checkSpotInterrupt(sqsClient);
	}

	let overalPollCount = 0;
	// keep polling unless instance is scheduled for termination
	whileLoop: while (!INTERRUPTION_TIME) {
		overalPollCount += 1;
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
			// prefer 'high' over 'standard', and actually kill 'low' if anything comes in on the 'high'/'standard'
			for (const priorityLevel of priorityLevels) {
				// always prefer 'regular-sensitivity' here, as something else might pick up 'public-domain' (but still process 'public-domain' when there's no 'regular-sensitivity' jobs)
				for (const sensitivityLevel of sensitivityLevels) {
					// take it in turns for the activityType
					for (const activityType of activityTypes) {
						//TODO see if we can store what activityType was LAST processed so we can understand warm-up time impact
						// from swapping between activity types (e.g. transcription vs translation) and if we can improve throughput
						// by processing the same activity type in a row

						const queueUrl = buildQueueUrl(
							config.app.queuesBaseUrl,
							'queue',
							priorityLevel,
							sensitivityLevel,
							activityType,
							config.app.queueGardensStage,
						);

						const shouldOnlyProcessIfIdleAndIsThereforeCancellable =
							priorityLevel === 'low';

						if (
							shouldOnlyProcessIfIdleAndIsThereforeCancellable &&
							maybeCurrentIdleTaskAborter
						) {
							// idle task already in progress and this is low priority, so continue through the loops
							continue;
						}

						const maybeMessage = await pollQueue(
							overalPollCount,
							sqsClient,
							queueUrl,
							autoScalingClient,
							asgName,
							config,
							instanceId,
						);

						if (!maybeMessage) {
							// no message on the queue, so continue through the loops to check the next queue
							continue;
						}

						if (maybeCurrentIdleTaskAborter) {
							console.log(
								`New higher priority work has arrived, aborting current idle task. Waiting 5s for it to exit before starting the new work.`,
							);
							maybeCurrentIdleTaskAborter.abort(
								'New higher priority work has arrived.',
							);
							await setTimeout(5000);
						}

						const workPromise = doWorkIfAny(
							maybeMessage,
							sqsClient,
							queueUrl,
							autoScalingClient,
							asgName,
							metrics,
							config,
							instanceId,
						);

						if (shouldOnlyProcessIfIdleAndIsThereforeCancellable) {
							maybeCurrentIdleTaskAborter = new AbortController();
							workPromise.finally(() => {
								// regardless of success/failure, when this idle task concludes clear the reference
								maybeCurrentIdleTaskAborter = null;
								// TODO reset the visibility of the message so that it returns to front of its queue
							});
						} else {
							const result = await workPromise;
							if (result !== null) {
								// something was processed, so go back to the top of the while loop to start with the highest priority
								continue whileLoop;
							}
						}
					}
				}
			}
		} else {
			logger.warn(
				`instance in state ${lifecycleState} - waiting until it goes to InService.`,
			);
		}
		await setTimeout(POLLING_INTERVAL_SECONDS * 1000);
	}
};

const pollQueue = async (
	overallPollCount: number,
	sqsClient: SQSClient,
	taskQueueUrl: string,
	autoScalingClient: AutoScalingClient,
	asgName: string,
	config: TranscriptionConfig,
	instanceId: string,
) => {
	const stage = config.app.stage;

	logger.info(
		`worker polling ${taskQueueUrl} for task. Overall poll count = ${overallPollCount}`,
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
		return null; // null denotes nothing on the queue
	}

	return message.message;
};

const doWorkIfAny = async (
	taskMessage: Message,
	sqsClient: SQSClient,
	taskQueueUrl: string,
	autoScalingClient: AutoScalingClient,
	asgName: string,
	metrics: MetricsService,
	config: TranscriptionConfig,
	instanceId: string,
): Promise<void | null> => {
	const stage = config.app.stage;
	const isDev = config.app.stage === 'DEV';

	const attemptNumber = parseInt(
		taskMessage.Attributes?.ApproximateReceiveCount ?? '0',
	);
	await metrics.putMetric(attemptNumberMetric(attemptNumber));

	const maybeSentTimestamp: string | undefined | null =
		taskMessage.Attributes?.SentTimestamp;
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

	// these attributes are preserved from the original job message and re-attached to the output message (success or
	// failure) so that Giant can match the result back to the relevant blob/extractor
	const preservedAttributes = getForwardedMessageAttributes(taskMessage);

	const job = parseTranscriptJobMessage(taskMessage);

	if (!job) {
		await metrics.putMetric(FailureMetric);
		logger.error('Failed to parse job message', taskMessage);
		await updateScaleInProtection(
			autoScalingClient,
			stage,
			false,
			instanceId,
			asgName,
		);
		return;
	}

	CURRENT_QUEUE_URL = taskQueueUrl;

	const setMessageVisibility = async (visibilityTimeoutSeconds: number) => {
		await changeMessageVisibility(
			sqsClient,
			taskQueueUrl,
			receiptHandle,
			visibilityTimeoutSeconds,
		);
	};

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

		if (maybeCurrentIdleTaskAborter?.signal.aborted) {
			return;
		}

		const downloadedFile = await getObjectWithPresignedUrl(
			inputSignedUrl,
			job.id,
			destinationDirectory,
		);

		if (maybeCurrentIdleTaskAborter?.signal.aborted) {
			return;
		}

		if (jobType === 'llm' || jobType === 'llm-translation') {
			await processLLMOrTranslationJob(
				job,
				downloadedFile,
				config,
				sqsClient,
				setMessageVisibility,
				metrics,
				preservedAttributes,
				maybeCurrentIdleTaskAborter?.signal,
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
				setMessageVisibility,
				preservedAttributes,
				maybeCurrentIdleTaskAborter?.signal,
			);
		}

		logger.info(`Deleting message ${taskMessage.MessageId}`);
		await deleteMessage(sqsClient, taskQueueUrl, receiptHandle, job.id);
	} catch (error) {
		const msg = 'Worker failed to complete';
		logger.error(msg, error);
		// Terminate the message visibility timeout
		await setMessageVisibility(0);

		// the type of ApproximateReceiveCount is string | undefined so need to
		// handle the case where its missing. use default value
		// MAX_RECEIVE_COUNT since its probably better to send too many failure
		// messages than to not send any.
		const defaultReceiveCount = MAX_RECEIVE_COUNT.toString();
		const receiveCount = parseInt(
			taskMessage.Attributes?.ApproximateReceiveCount || defaultReceiveCount,
		);
		if (receiveCount >= MAX_RECEIVE_COUNT) {
			if (job.jobType === 'llm' || job.jobType === 'llm-translation') {
				const llmFailure: LLMOutputFailure = {
					id: job.id,
					status: 'LLM_FAILURE',
					userEmail: job.userEmail,
				};
				await publishTranscriptionOutput(
					sqsClient,
					config.app.destinationQueueUrls[job.transcriptDestinationService],
					llmFailure,
					preservedAttributes,
				);
			} else {
				await publishTranscriptionOutputFailure(
					sqsClient,
					config.app.destinationQueueUrls[job.transcriptDestinationService],
					job,
					false,
					preservedAttributes,
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
