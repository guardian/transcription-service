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
	DestinationService,
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

import { getInstanceLifecycleState, updateScaleInProtection } from './asg';
import { uploadedCombinedResultsToS3 } from './util';
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
		isTranslation: job.translate,
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
	const enqueueTimestampInMillis =
		maybeSentTimestamp && parseInt(maybeSentTimestamp);
	const now = new Date();
	const maybeSecondsFromEnqueueToStartMetric =
		enqueueTimestampInMillis &&
		(now.getTime() - enqueueTimestampInMillis) / 1000;

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

		// Giant doesn't know the language of files uploaded to it, so for Giant files we first run language detection
		// then based on the output, either run transcription or run transcription and translation, and return the output
		// of both to the user. This is different from the transcription-service, where transcription and translation are
		// two separate jobs
		const combineTranscribeAndTranslate =
			job.transcriptDestinationService === DestinationService.Giant &&
			job.translate;
		const extraTranslationTimeMultiplier = combineTranscribeAndTranslate
			? 2
			: 1;

		if (ffmpegResult.duration && ffmpegResult.duration !== 0) {
			// Transcription time is usually slightly longer than file duration.
			// Update visibility timeout to 2x the file duration plus 25 minutes for the model to load.
			// (TODO: investigate whisperx model load time/transcription performance further - it seems to vary)
			// This should avoid another worker picking up the task and to allow
			// this worker to delete the message when it's finished.
			await changeMessageVisibility(
				sqsClient,
				taskQueueUrl,
				receiptHandle,
				(ffmpegResult.duration * 2 + 1500) * extraTranslationTimeMultiplier,
			);
		}

		const whisperBaseParams: WhisperBaseParams = {
			containerId,
			wavPath: wavPath,
			file: fileToTranscribe,
			numberOfThreads,
			// whisperx always runs on powerful gpu instances so let's always use the medium model
			model:
				job.engine !== 'whisperx' && config.app.stage !== 'PROD'
					? 'tiny'
					: 'medium',
			engine: job.engine,
			diarize: job.diarize,
			stage: config.app.stage,
		};

		const transcriptionStartTime = new Date();
		const transcriptResult = await getTranscriptionText(
			whisperBaseParams,
			job.languageCode,
			job.translate,
			combineTranscribeAndTranslate,
			job.engine === 'whisperx',
		);
		const transcriptionEndTime = new Date();
		const transcriptionTimeSeconds = Math.round(
			(transcriptionEndTime.getTime() - transcriptionStartTime.getTime()) /
				1000,
		);
		const transcriptionRate =
			ffmpegResult.duration && ffmpegResult.duration / transcriptionTimeSeconds;

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
			isTranslation: job.translate,
			duration: ffmpegResult.duration,
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
