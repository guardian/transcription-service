import path from 'path';
import {
	changeMessageVisibility,
	deleteMessage,
	moveMessageToDeadLetterQueue,
	publishTranscriptionOutput,
	readFile,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { logger } from '@guardian/transcription-service-backend-common';
import {
	InputLanguageCode,
	languageCodes,
	OutputLanguageCode,
	TranscriptionEngine,
	TranscriptionJob,
	TranscriptionMetadata,
	TranscriptionOutputFailure,
	type TranscriptionOutputSuccess,
	TranscriptionResult,
} from '@guardian/transcription-service-common';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';
import {
	MetricsService,
	secondsForWhisperXStartupMetric,
	transcriptionRateMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { SHAKIRA } from './shakira';
import { transcribeAndTranslate } from './translate';
import { Message, SQSClient } from '@aws-sdk/client-sqs';
import fs from 'node:fs';
import { uploadedCombinedResultsToS3 } from './util';

interface FfmpegResult {
	duration?: number;
	fileContainsNoAudio: boolean;
	failed: boolean;
}

export type WhisperModel = 'medium' | 'tiny';

export type WhisperBaseParams = {
	containerId?: string;
	wavPath: string;
	file: string;
	model: WhisperModel;
	engine: TranscriptionEngine;
	diarize: boolean;
	stage: string;
	huggingFaceToken?: string;
	translationDirectory: string;
	baseDirectory: string;
};

export const getFfmpegParams = (
	sourceFilePath: string,
	outputWavPath: string,
) => {
	return [
		'-y',
		'-i',
		sourceFilePath,
		'-ar',
		'16000',
		'-ac',
		'1',
		'-c:a',
		'pcm_s16le',
		outputWavPath,
	];
};

export const runFfmpeg = async (
	ffmpegParams: string[],
): Promise<FfmpegResult | undefined> => {
	try {
		const res = await runSpawnCommand(
			'convertToWav',
			'ffmpeg',
			ffmpegParams,
			true,
			false,
		);

		const duration = getDuration(res.stderr);

		const fileContainsNoAudio = res.stderr.includes(
			'Output file #0 does not contain any stream',
		);

		return {
			duration,
			fileContainsNoAudio,
			failed: !!(res.code && res.code !== 0),
		};
	} catch (error) {
		logger.error('ffmpeg failed error:', error);
		return undefined;
	}
};

const getDuration = (ffmpegOutput: string) => {
	const reg = /Duration: (\d{1,2}):(\d{1,2}):(\d{1,2}).\d{1,2},/.exec(
		ffmpegOutput,
	);
	if (!reg || reg.length < 4) {
		logger.warn('Could not retrieve duration from the ffmpeg result.');
		return undefined;
	}
	const hour = reg[1] ? parseInt(reg[1]) : 0;
	const minute = reg[2] ? parseInt(reg[2]) : 0;
	const seconds = reg[3] ? parseInt(reg[3]) : 0;
	const duration = hour * 3600 + minute * 60 + seconds;
	logger.info(`File duration is ${duration} seconds`);
	return duration;
};

export const runTranscription = async (
	whisperBaseParams: WhisperBaseParams,
	languageCode: InputLanguageCode,
	translate: boolean,
	metrics: MetricsService,
) => {
	try {
		const { fileName, metadata } = await runWhisperX(
			whisperBaseParams,
			languageCode,
			translate,
			metrics,
		);

		const outputDir = translate
			? whisperBaseParams.translationDirectory
			: whisperBaseParams.baseDirectory;

		const srtPath = path.resolve(outputDir, `${fileName}.srt`);
		const textPath = path.resolve(outputDir, `${fileName}.txt`);
		const jsonPath = path.resolve(outputDir, `${fileName}.json`);

		const transcripts = {
			srt: readFile(srtPath),
			text: readFile(textPath),
			json: readFile(jsonPath),
		};

		return { transcripts, metadata };
	} catch (error) {
		logger.error(
			`Could not read the transcript result. Params: ${JSON.stringify(whisperBaseParams)}`,
			error,
		);
		throw error;
	}
};

export const getTranscriptionText = async (
	whisperBaseParams: WhisperBaseParams,
	languageCode: InputLanguageCode,
	translate: boolean,
	metrics: MetricsService,
): Promise<TranscriptionResult> => {
	if (process.env.SHAKIRA_MODE) {
		// in shakira mode, all input transcribes to shakira
		return SHAKIRA;
	}
	if (translate) {
		return transcribeAndTranslate(whisperBaseParams, metrics, languageCode);
	}
	return runTranscription(whisperBaseParams, languageCode, translate, metrics);
};

const regexExtract = (text: string, regex: RegExp): string | undefined => {
	const regexResult = text.match(regex);
	return regexResult ? regexResult[1] : undefined;
};

const parseLanguageCodeString = (languageCode?: string): OutputLanguageCode =>
	languageCodes.find((c) => c === languageCode) || 'UNKNOWN';

const extractWhisperXStdoutData = (stdout: string): TranscriptionMetadata => {
	//Detected language: en (0.99) in first 30s of audio...
	const languageRegex = /Detected language: ([a-zA-Z]{2})/;
	const detectedLanguageCode = regexExtract(stdout, languageRegex);
	return {
		detectedLanguageCode: parseLanguageCodeString(detectedLanguageCode),
	};
};

export const runWhisperX = async (
	whisperBaseParams: WhisperBaseParams,
	languageCode: InputLanguageCode,
	translate: boolean,
	metrics: MetricsService,
) => {
	const { wavPath, stage, diarize, huggingFaceToken } = whisperBaseParams;
	const fileName = path.parse(wavPath).name;
	const model =
		languageCode === 'auto' || languageCode === 'en' ? 'large' : 'large';
	const languageCodeParam =
		languageCode === 'auto' ? [] : ['--language', languageCode];
	const translateParam = translate ? ['--task', 'translate'] : [];
	const diarizeParam = diarize ? [`--diarize`] : [];

	// below settings deal with differences between DEV and CODE/PROD environments

	// On mac arm processors, we need to set the compute type to int8
	// see https://github.com/m-bain/whisperX?tab=readme-ov-file#usage--command-line
	const computeParam = stage === 'DEV' ? ['--compute', 'int8'] : [];
	// in DEV we can (and might need to) download models, otherwise they will be
	// baked into the AMI
	const useCachedModelsParam =
		stage === 'DEV' ? [] : ['--model_cache_only', 'True'];
	const huggingfaceTokenParam =
		stage === 'DEV' && huggingFaceToken ? ['--hf_token', huggingFaceToken] : [];

	const outputDir = translate
		? whisperBaseParams.translationDirectory
		: whisperBaseParams.baseDirectory;

	try {
		let secondsForWhisperXStartup: number | undefined = undefined;
		const startEpochMillis = Date.now();
		const result = await runSpawnCommand(
			'transcribe-whisperx',
			'whisperx',
			[
				'--model',
				model,
				...languageCodeParam,
				...translateParam,
				...diarizeParam,
				...computeParam,
				'--no_align',
				...useCachedModelsParam,
				...huggingfaceTokenParam,
				'--output_dir',
				outputDir,
				wavPath,
			],
			false,
			true,
			(data) => {
				if (!secondsForWhisperXStartup && 'stdout' in data) {
					secondsForWhisperXStartup = (Date.now() - startEpochMillis) / 1000;
					logger.info(
						`WhisperX has started actually doing something, after ${secondsForWhisperXStartup}s`,
						{ secondsForWhisperXStartup },
					);
					metrics.putMetric(
						secondsForWhisperXStartupMetric(secondsForWhisperXStartup),
					);
				}
			},
		);
		if (!secondsForWhisperXStartup) {
			secondsForWhisperXStartup = (Date.now() - startEpochMillis) / 1000;
			logger.warn(
				`WhisperX did not log anything, so startup time is really total duration: ${secondsForWhisperXStartup}s`,
				{ secondsForWhisperXStartup },
			);
		}
		const metadata = extractWhisperXStdoutData(result.stdout);
		logger.info('Whisper finished successfully', metadata);
		return {
			fileName,
			metadata,
		};
	} catch (error) {
		logger.error(`Whisper failed due to `, error);
		throw error;
	}
};

export const publishTranscriptionOutputFailure = async (
	sqsClient: SQSClient,
	destination: string,
	job: TranscriptionJob,
	noAudioDetected: boolean = false,
) => {
	logger.info(`Sending failure message to ${destination}`);
	const failureMessage: TranscriptionOutputFailure = {
		id: job.id,
		status: 'TRANSCRIPTION_FAILURE',
		userEmail: job.userEmail,
		originalFilename: job.originalFilename,
		noAudioDetected: noAudioDetected,
	};
	try {
		await publishTranscriptionOutput(sqsClient, destination, failureMessage);
	} catch (e) {
		logger.error(`error publishing failure message to ${destination}`, e);
	}
};

export const processTranscriptionJob = async (
	job: TranscriptionJob,
	fileToTranscribe: string,
	destinationDirectory: string,
	sqsClient: SQSClient,
	config: TranscriptionConfig,
	taskQueueUrl: string,
	receiptHandle: string,
	isDev: boolean,
	metrics: MetricsService,
	taskMessage: Message,
	maybeEnqueuedAtEpochMillis: number | undefined,
	interruptionTime: Date | undefined,
) => {
	logger.info(
		`Fetched transcription job with id ${job.id}, engine ${job.engine}`,
	);

	const translationDirectory = `${destinationDirectory}/translation/`;
	fs.mkdirSync(translationDirectory, { recursive: true });

	const fileName = path.basename(fileToTranscribe);
	const filePath = `${destinationDirectory}/${fileName}`;
	const wavPath = `${destinationDirectory}/${fileName}-converted.wav`;
	logger.info(`Input file path: ${filePath}, Output file path: ${wavPath}`);

	const ffmpegParams = getFfmpegParams(filePath, wavPath);

	const ffmpegResult = await runFfmpeg(ffmpegParams);

	if (
		ffmpegResult === undefined ||
		(ffmpegResult?.failed && !ffmpegResult.fileContainsNoAudio)
	) {
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
				taskMessage.Body!,
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
	if (ffmpegResult.fileContainsNoAudio) {
		logger.warn(
			'No audio detected in file - deleting from queue without moving to dead letter queue and returning failure message',
		);
		await publishTranscriptionOutputFailure(
			sqsClient,
			config.app.destinationQueueUrls[job.transcriptDestinationService],
			job,
			true,
		);
		await deleteMessage(sqsClient, taskQueueUrl, receiptHandle, job.id);
		return;
	}

	const extraTranslationTimeMultiplier = job.translate ? 2 : 1;

	if (ffmpegResult.duration && ffmpegResult.duration !== 0) {
		const visibilityTimeoutSeconds =
			Math.floor(ffmpegResult.duration * 1.2 + 300) *
			extraTranslationTimeMultiplier;
		await changeMessageVisibility(
			sqsClient,
			taskQueueUrl,
			receiptHandle,
			visibilityTimeoutSeconds,
		);
	}

	const whisperBaseParams: WhisperBaseParams = {
		wavPath: wavPath,
		file: fileToTranscribe,
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
		metrics,
	);

	const transcriptionEndTime = new Date();
	const transcriptionTimeSeconds = Math.round(
		(transcriptionEndTime.getTime() - transcriptionStartTime.getTime()) / 1000,
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
		interruptionTime &&
		interruptionTime.getTime() - new Date().getTime() < 20 * 1000
	) {
		logger.warn('Spot termination happening soon, abandoning transcription');
		// exit cleanly to prevent systemd restarting the process
		process.exit(0);
	}

	await uploadedCombinedResultsToS3(
		job.combinedOutputUrl.url,
		transcriptResult,
	);

	const transcriptionOutput: TranscriptionOutputSuccess = {
		id: job.id,
		status: 'SUCCESS',
		languageCode,
		userEmail: job.userEmail,
		originalFilename: job.originalFilename,
		combinedOutputKey: job.combinedOutputUrl?.key,
		translationRequested: job.translate,
		includesTranslation: transcriptResult.transcriptTranslations !== undefined,
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
};
