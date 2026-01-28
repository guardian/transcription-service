import path from 'path';
import { readFile } from '@guardian/transcription-service-backend-common';
import { logger } from '@guardian/transcription-service-backend-common';
import {
	InputLanguageCode,
	languageCodes,
	OutputLanguageCode,
	TranscriptionEngine,
	TranscriptionMetadata,
	TranscriptionResult,
} from '@guardian/transcription-service-common';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';
import {
	MetricsService,
	secondsForWhisperXStartupMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { SHAKIRA } from './shakira';
import { transcribeAndTranslate } from './translate';

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
	numberOfThreads: number;
	model: WhisperModel;
	engine: TranscriptionEngine;
	diarize: boolean;
	stage: string;
	huggingFaceToken?: string;
	translationDirectory: string;
	baseDirectory: string;
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
					false,
				)
			: await runSpawnCommand(
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
			failed: res.code && res.code !== 0,
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
	whisperX: boolean,
	metrics: MetricsService,
) => {
	try {
		const params = whisperParams(
			false,
			whisperBaseParams.wavPath,
			languageCode,
			translate,
		);
		const { fileName, metadata } = whisperX
			? await runWhisperX(whisperBaseParams, languageCode, translate, metrics)
			: await runWhisper(whisperBaseParams, params);

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
	whisperX: boolean,
	metrics: MetricsService,
): Promise<TranscriptionResult> => {
	if (process.env.SHAKIRA_MODE) {
		// in shakira mode, all input transcribes to shakira
		return SHAKIRA;
	}
	if (translate) {
		return transcribeAndTranslate(
			whisperBaseParams,
			whisperX,
			metrics,
			languageCode,
		);
	}
	return runTranscription(
		whisperBaseParams,
		languageCode,
		translate,
		whisperX,
		metrics,
	);
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
