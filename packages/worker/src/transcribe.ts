import path from 'path';
import {
	changeMessageVisibility,
	logger,
	moveMessageToDeadLetterQueue,
	readFile,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import {
	DestinationService,
	InputLanguageCode,
	inputToOutputLanguageCode,
	languageCodes,
	OutputLanguageCode,
	TranscriptionEngine,
	TranscriptionJob,
	TranscriptionMetadata,
	TranscriptionResult,
} from '@guardian/transcription-service-common';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';
import { Message, SQSClient } from '@aws-sdk/client-sqs';

interface FfmpegResult {
	duration?: number;
}

export type WhisperModel = 'medium' | 'tiny';

export type WhisperBaseParams = {
	containerId?: string;
	wavPath: string;
	file: string;
	numberOfThreads: number;
	model: WhisperModel;
	engine: TranscriptionEngine;
	diarize: boolean;
	stage: string;
};

export const CONTAINER_FOLDER = '/input';

export const getOrCreateContainer = async (
	tempDir: string,
): Promise<string> => {
	const existingContainer = await runSpawnCommand(
		'getContainer',
		'docker',
		['ps', '--filter', 'name=whisper', '--format', '{{.ID}}'],
		true,
	);

	if (existingContainer.stdout) {
		return existingContainer.stdout.trim();
	}

	const newContainer = await runSpawnCommand('createNewContainer', 'docker', [
		'run',
		'-t',
		'-d',
		'--name',
		'whisper',
		'-v',
		`${tempDir}:${CONTAINER_FOLDER}`,
		'ghcr.io/guardian/transcription-service',
	]);
	return newContainer.stdout.trim();
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
	containerId?: string,
): Promise<FfmpegResult | undefined> => {
	try {
		const res = containerId
			? await runSpawnCommand(
					'convertToWav',
					'docker',
					['exec', containerId, 'ffmpeg', ...ffmpegParams],
					true,
				)
			: await runSpawnCommand('convertToWav', 'ffmpeg', ffmpegParams, true);

		const duration = getDuration(res.stderr);

		return {
			duration,
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

export const getOutputFilePaths = (
	sourceFilePath: string,
	fileName: string,
) => {
	const directory = path.parse(sourceFilePath).dir;
	const srtPath = path.resolve(directory, `${fileName}.srt`);
	const textPath = path.resolve(directory, `${fileName}.txt`);
	const jsonPath = path.resolve(directory, `${fileName}.json`);

	return {
		srt: readFile(srtPath),
		text: readFile(textPath),
		json: readFile(jsonPath),
	};
};

const runTranscription = async (
	whisperBaseParams: WhisperBaseParams,
	languageCode: InputLanguageCode,
	translate: boolean,
	engine: TranscriptionEngine,
) => {
	try {
		const params = whisperParams(
			false,
			whisperBaseParams.wavPath,
			languageCode,
			translate,
		);

		const { fileName, metadata } = await (async () => {
			switch (engine) {
				case TranscriptionEngine.WHISPER_CPP:
					return runWhisper(whisperBaseParams, params);
				case TranscriptionEngine.WHISPER_X:
					return runWhisperX(whisperBaseParams, languageCode, translate);
				default:
					throw new Error(`Engine ${engine} not supported here`);
			}
		})();

		return {
			transcripts: getOutputFilePaths(whisperBaseParams.file, fileName),
			metadata,
		};
	} catch (error) {
		logger.error(
			`Could not read the transcript result. Params: ${JSON.stringify(whisperBaseParams)}`,
			error,
		);
		throw error;
	}
};

// This function is currently only used in the transcribeAndTranslate path (which at present is only used by giant).
// Giant doesn't have a UI component to provide the language of files uploaded, so we always need to detech the language
const getLanguageCode = async (
	whisperBaseParams: WhisperBaseParams,
	whisperX: boolean,
): Promise<InputLanguageCode> => {
	// whisperx is so slow to start up let's not even bother pre-detecting the language and just let it run detection
	// for both transcription and translation
	if (whisperX) {
		return Promise.resolve('auto');
	}
	// run whisper.cpp in 'detect language' mode
	const dlParams = whisperParams(true, whisperBaseParams.wavPath);
	const { metadata } = await runWhisper(whisperBaseParams, dlParams);
	return (
		languageCodes.find((c) => c === metadata.detectedLanguageCode) || 'auto'
	);
};

// Note: this functionality is only for transcription jobs coming from giant at the moment, though it could be good
// to make it the standard approach for the transcription tool too (rather than what happens currently, where the
// transcription API sends two messages to the worker - one for transcription, another for transcription with translation
// (see generateOutputSignedUrlAndSendMessage in sqs.ts)
const transcribeAndTranslate = async (
	whisperBaseParams: WhisperBaseParams,
	engine: TranscriptionEngine,
): Promise<TranscriptionResult> => {
	try {
		const languageCode = await getLanguageCode(
			whisperBaseParams,
			engine === TranscriptionEngine.WHISPER_X,
		);
		const transcription = await runTranscription(
			whisperBaseParams,
			languageCode,
			false,
			engine,
		);

		// we only run language detection once,
		// so need to override the detected language of future whisper runs
		transcription.metadata.detectedLanguageCode =
			inputToOutputLanguageCode(languageCode);
		const translation =
			languageCode === 'en'
				? null
				: await runTranscription(whisperBaseParams, languageCode, true, engine);
		return {
			transcripts: transcription.transcripts,
			transcriptTranslations: translation?.transcripts,
			// we only return one metadata field here even though we might have two (one from the translation) - a
			// bit messy but I can't think of much use for the translation metadata at the moment
			metadata: transcription.metadata,
		};
	} catch (error) {
		logger.error(
			`Failed during combined detect language/transcribe/translate process result`,
			error,
		);
		throw error;
	}
};

export const getTranscriptionText = async (
	whisperBaseParams: WhisperBaseParams,
	languageCode: InputLanguageCode,
	translate: boolean,
	combineTranscribeAndTranslate: boolean,
	engine: TranscriptionEngine,
): Promise<TranscriptionResult> => {
	if (combineTranscribeAndTranslate) {
		return transcribeAndTranslate(whisperBaseParams, engine);
	}
	return runTranscription(whisperBaseParams, languageCode, translate, engine);
};

const regexExtract = (text: string, regex: RegExp): string | undefined => {
	const regexResult = text.match(regex);
	return regexResult ? regexResult[1] : undefined;
};

const parseLanguageCodeString = (languageCode?: string): OutputLanguageCode =>
	languageCodes.find((c) => c === languageCode) || 'UNKNOWN';

const extractWhisperXStderrData = (stderr: string): TranscriptionMetadata => {
	//Detected language: en (0.99) in first 30s of audio...
	const languageRegex = /Detected language: ([a-zA-Z]{2})/;
	const detectedLanguageCode = regexExtract(stderr, languageRegex);
	return {
		detectedLanguageCode: parseLanguageCodeString(detectedLanguageCode),
	};
};

const extractWhisperStderrData = (stderr: string): TranscriptionMetadata => {
	const languageRegex = /auto-detected\slanguage: ([a-zA-Z]{2})/;
	const detectedLanguageCode = regexExtract(stderr, languageRegex);

	const totalTimeRegex =
		/whisper_print_timings:\s+total time =\s+(\d+\.\d+) ms/;
	const loadTimeRegex = /whisper_print_timings:\s+load time =\s+(\d+\.\d+) ms/;
	const totalTime = regexExtract(stderr, totalTimeRegex);
	const loadTime = regexExtract(stderr, loadTimeRegex);

	return {
		detectedLanguageCode: parseLanguageCodeString(detectedLanguageCode),
		loadTimeMs: loadTime ? parseInt(loadTime) : undefined,
		totalTimeMs: totalTime ? parseInt(totalTime) : undefined,
	};
};

const whisperParams = (
	detectLanguageOnly: boolean,
	file: string,
	languageCode: InputLanguageCode = 'auto',
	translate: boolean = false,
) => {
	if (detectLanguageOnly) {
		return ['--detect-language'];
	} else {
		const fileName = path.parse(file).name;
		const containerOutputFilePath = path.resolve(CONTAINER_FOLDER, fileName);
		logger.info(`Transcription output file path: ${containerOutputFilePath}`);
		const translateParam: string[] = translate ? ['--translate'] : [];
		return [
			'--output-srt',
			'--output-txt',
			'--output-json',
			'--output-file',
			containerOutputFilePath,
			'--language',
			languageCode,
		].concat(translateParam);
	}
};

type PatakeetParams = {
	mediaPath: string;
};

export const runParakeet = async (params: PatakeetParams) => {
	const fileName = path.parse(params.mediaPath).name;
	const model = 'mlx-community/parakeet-tdt-0.6b-v3';
	try {
		await runSpawnCommand('transcribe-parakeet', 'parakeet-mlx', [
			'--model',
			model,
			'--output-dir',
			path.parse(params.mediaPath).dir,
			params.mediaPath,
		]);
		logger.info('Parakeet finished successfully');
		return {
			fileName,
			metadata: undefined,
		};
	} catch (error) {
		logger.error(`Parakeet failed due to `, error);
		throw error;
	}
};

export const getParakeetTranscription = async (
	params: PatakeetParams,
): Promise<TranscriptionResult> => {
	const res = await runParakeet(params);
	const transcripts = getOutputFilePaths(params.mediaPath, res.fileName);
	return {
		transcripts,
		metadata: {
			detectedLanguageCode: 'UNKNOWN',
		},
	};
};

export const runWhisperX = async (
	whisperBaseParams: WhisperBaseParams,
	languageCode: InputLanguageCode,
	translate: boolean,
) => {
	const { wavPath, diarize, stage } = whisperBaseParams;
	const fileName = path.parse(wavPath).name;
	const model = languageCode === 'en' ? whisperBaseParams.model : 'large';
	const languageCodeParam =
		languageCode === 'auto' ? [] : ['--language', languageCode];
	const translateParam = translate ? ['--task', 'translate'] : [];
	// On mac arm processors, we need to set the compute type to int8
	// see https://github.com/m-bain/whisperX?tab=readme-ov-file#usage--command-line
	const computeParam = stage === 'DEV' ? ['--compute', 'int8'] : [];
	try {
		const diarizeParam = diarize ? [`--diarize`] : [];
		const result = await runSpawnCommand('transcribe-whisperx', 'whisperx', [
			'--model',
			model,
			...languageCodeParam,
			...translateParam,
			...diarizeParam,
			...computeParam,
			'--no_align',
			'--model_cache_only',
			'True',
			'--output_dir',
			path.parse(wavPath).dir,
			wavPath,
		]);
		const metadata = extractWhisperXStderrData(result.stderr);
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

export const runWhisper = async (
	whisperBaseParams: WhisperBaseParams,
	whisperParams: string[],
) => {
	const { containerId, numberOfThreads, model, wavPath } = whisperBaseParams;
	if (!containerId) {
		throw new Error(
			"Container id undefined - can't run whisper container (has this worker ended up in whisperX mode?)",
		);
	}
	const fileName = path.parse(wavPath).name;
	logger.info(
		`Runnning whisper with params ${whisperParams}, base params: ${JSON.stringify(whisperBaseParams, null, 2)}`,
	);

	try {
		const result = await runSpawnCommand('transcribe', 'docker', [
			'exec',
			containerId,
			'whisper.cpp/main',
			'--model',
			`whisper.cpp/models/ggml-${model}.bin`,
			'--threads',
			numberOfThreads.toString(),
			'--file',
			wavPath,
			...whisperParams,
		]);
		const metadata = extractWhisperStderrData(result.stderr);
		logger.info('Whisper finished successfully', metadata);
		return {
			fileName: `${fileName}`,
			metadata,
		};
	} catch (error) {
		logger.error(`Whisper failed due to `, error);
		throw error;
	}
};

export const whisperTranscription = async (
	job: TranscriptionJob,
	config: TranscriptionConfig,
	destinationDirectory: string,
	fileToTranscribe: string,
	sqsClient: SQSClient,
	taskQueueUrl: string,
	taskMessage: Message,
	receiptHandle: string,
): Promise<TranscriptionResult | null> => {
	const isDev = config.app.stage === 'DEV';
	const useContainer = job.engine !== TranscriptionEngine.WHISPER_X;

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
				taskMessage.Body || '',
				receiptHandle,
				job.id,
			);
			logger.info(
				`moved message with message id ${taskMessage.MessageId} to dead letter queue.`,
			);
		} else {
			logger.info('skip moving message to dead letter queue in DEV');
		}
		return null;
	}

	// Giant doesn't know the language of files uploaded to it, so for Giant files we first run language detection
	// then based on the output, either run transcription or run transcription and translation, and return the output
	// of both to the user. This is different from the transcription-service, where transcription and translation are
	// two separate jobs
	const combineTranscribeAndTranslate =
		job.transcriptDestinationService === DestinationService.Giant &&
		job.translate;
	const extraTranslationTimeMultiplier = combineTranscribeAndTranslate ? 2 : 1;

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
		numberOfThreads: config.app.stage === 'PROD' ? 16 : 2,
		// whisperx always runs on powerful gpu instances so let's always use the medium model
		model:
			job.engine !== 'whisperx' && config.app.stage !== 'PROD'
				? 'tiny'
				: 'medium',
		engine: job.engine,
		diarize: job.diarize,
		stage: config.app.stage,
	};

	const transcriptResult = await getTranscriptionText(
		whisperBaseParams,
		job.languageCode,
		job.translate,
		combineTranscribeAndTranslate,
		job.engine,
	);

	return transcriptResult;
};
