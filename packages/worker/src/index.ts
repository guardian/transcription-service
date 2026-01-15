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
	getS3Client,
} from '@guardian/transcription-service-backend-common';
import {
	OutputLanguageCode,
	TranscriptionJob,
	TranscriptionOutputFailure,
	type TranscriptionOutputSuccess,
} from '@guardian/transcription-service-common';
import {
	getTranscriptionText,
	runFfmpeg,
	getOrCreateContainer,
	WhisperBaseParams,
	CONTAINER_FOLDER,
	getFfmpegParams,
} from './transcribe';
import path from 'path';

import {
	getInstanceLifecycleState,
	terminateInstance,
	updateScaleInProtection,
} from './asg';
import { uploadedCombinedResultsToS3 } from './util';
import {
	MetricsService,
	FailureMetric,
	secondsFromEnqueueToStartMetric,
	attemptNumberMetric,
	transcriptionRateMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { SQSClient } from '@aws-sdk/client-sqs';
import { setTimeout } from 'timers/promises';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common';
import { checkSpotInterrupt } from './spot-termination';
import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';
import fs from 'node:fs';
import { newArtifactAvailable } from './s3';

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

const publishTranscriptionOutputFailure = async (
	sqsClient: SQSClient,
	destination: string,
	job: TranscriptionJob,
) => {
	logger.info(`Sending failure message to ${destination}`);
	const failureMessage: TranscriptionOutputFailure = {
		id: job.id,
		status: 'TRANSCRIPTION_FAILURE',
		userEmail: job.userEmail,
		originalFilename: job.originalFilename,
	};
	try {
		await publishTranscriptionOutput(sqsClient, destination, failureMessage);
	} catch (e) {
		logger.error(`error publishing failure message to ${destination}`, e);
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
	const numberOfThreads = config.app.stage === 'PROD' ? 16 : 2;
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
	const maybeEnqueuedAtEpochMillis =
		maybeSentTimestamp && parseInt(maybeSentTimestamp);
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

		const { inputSignedUrl, combinedOutputUrl } = job;

		logger.info(
			`Fetched transcription job with id ${job.id}, engine ${job.engine}`,
		);

		const destinationDirectory = isDev
			? `${__dirname}/../../../worker-tmp-files`
			: '/tmp';
		const translationDirectory = `${destinationDirectory}/translation/`;

		logger.info(
			`Ensuring ${destinationDirectory} and ${translationDirectory} exist`,
		);
		fs.mkdirSync(destinationDirectory, { recursive: true });
		fs.mkdirSync(translationDirectory, { recursive: true });

		const fileToTranscribe = await getObjectWithPresignedUrl(
			inputSignedUrl,
			job.id,
			destinationDirectory,
		);

		const useContainer = job.engine !== 'whisperx';

		const ffmpegDir = useContainer ? CONTAINER_FOLDER : destinationDirectory;

		const fileName = path.basename(fileToTranscribe);
		const filePath = `${ffmpegDir}/${fileName}`;
		const wavPath = `${ffmpegDir}/${fileName}-converted.wav`;
		logger.info(`Input file path: ${filePath}, Output file path: ${wavPath}`);

		const ffmpegParams = getFfmpegParams(filePath, wavPath);

		// docker container to run ffmpeg and whisper on file
		const containerId = useContainer
			? await getOrCreateContainer(path.parse(fileToTranscribe).dir)
			: undefined;

		const ffmpegResult = await runFfmpeg(ffmpegParams, containerId);

		if (ffmpegResult === undefined) {
			// when ffmpeg fails to transcribe, move message to the dead letter
			// queue
			if (!isDev && config.app.deadLetterQueueUrl) {
				logger.error(
					`'ffmpeg failed, moving message with message id ${taskMessage.MessageId} to dead letter queue`,
				);
				await moveMessageToDeadLetterQueue(
					sqsClient,
					taskQueueUrl,
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

		const extraTranslationTimeMultiplier = job.translate ? 2 : 1;

		if (ffmpegResult.duration && ffmpegResult.duration !== 0) {
			// Transcription time is usually slightly longer than file duration.
			// Update visibility timeout to 2x the file duration plus 1 hour for the model to load.
			// (TODO: investigate whisperx model load time/transcription performance further - it seems to vary)
			// This should avoid another worker picking up the task and to allow
			// this worker to delete the message when it's finished.
			await changeMessageVisibility(
				sqsClient,
				taskQueueUrl,
				receiptHandle,
				(ffmpegResult.duration * 2 + 3_600) * extraTranslationTimeMultiplier,
			);
		}

		const whisperBaseParams: WhisperBaseParams = {
			containerId,
			wavPath: wavPath,
			file: fileToTranscribe,
			numberOfThreads,
			// whisperx always runs on powerful gpu instances so let's always use the medium model
			model: config.app.stage === 'DEV' ? 'tiny' : 'medium',
			engine: job.engine,
			diarize: job.diarize,
			stage: config.app.stage,
			huggingFaceToken: config.dev?.huggingfaceToken,
			baseDirectory: destinationDirectory,
			translationDirectory,
		};

		const transcriptionStartTime = new Date();

		const transcriptResult = await getTranscriptionText(
			whisperBaseParams,
			job.languageCode,
			job.translate,
			job.engine === 'whisperx',
			metrics,
		);

		const transcriptionEndTime = new Date();
		const transcriptionTimeSeconds = Math.round(
			(transcriptionEndTime.getTime() - transcriptionStartTime.getTime()) /
				1000,
		);
		const transcriptionRate =
			ffmpegResult.duration &&
			transcriptionTimeSeconds > 0 &&
			ffmpegResult.duration / transcriptionTimeSeconds;

		if (transcriptionRate) {
			await metrics.putMetric(transcriptionRateMetric(transcriptionRate));
		}

		const languageCode: OutputLanguageCode =
			job.languageCode === 'auto'
				? transcriptResult.metadata.detectedLanguageCode
				: job.languageCode;

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
			translationRequested: job.translate,
			includesTranslation:
				transcriptResult.transcriptTranslations !== undefined,
			duration: ffmpegResult.duration,
			maybeEnqueuedAtEpochMillis: maybeEnqueuedAtEpochMillis || undefined,
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
				mediaDurationSeconds: ffmpegResult.duration || 0,
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
