import path from 'path';
import { readFile } from '@guardian/transcription-service-backend-common';
import { logger } from '@guardian/transcription-service-backend-common';
import {
	LanguageCode,
	languageCodes,
	TranscriptionEngine,
} from '@guardian/transcription-service-common';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';

interface FfmpegResult {
	duration?: number;
}

export type WhisperModel = 'medium' | 'tiny';

export interface Transcripts {
	srt: string;
	text: string;
	json: string;
}

type TranscriptionMetadata = {
	detectedLanguageCode?: string;
	loadTimeMs?: number;
	totalTimeMs?: number;
};

type TranscriptionResult = {
	transcripts: Transcripts;
	transcriptTranslations?: Transcripts;
	metadata: TranscriptionMetadata;
};

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

const runTranscription = async (
	whisperBaseParams: WhisperBaseParams,
	languageCode: LanguageCode,
	translate: boolean,
	whisperX: boolean,
) => {
	try {
		const params = whisperParams(
			false,
			whisperBaseParams.wavPath,
			languageCode,
			translate,
		);
		const { fileName, metadata } = whisperX
			? await runWhisperX(whisperBaseParams, languageCode, translate)
			: await runWhisper(whisperBaseParams, params);

		const srtPath = path.resolve(
			path.parse(whisperBaseParams.file).dir,
			`${fileName}.srt`,
		);
		const textPath = path.resolve(
			path.parse(whisperBaseParams.file).dir,
			`${fileName}.txt`,
		);
		const jsonPath = path.resolve(
			path.parse(whisperBaseParams.file).dir,
			`${fileName}.json`,
		);

		const transcripts = {
			srt: readFile(srtPath),
			text: readFile(textPath),
			json: readFile(jsonPath),
		};

		return { transcripts, metadata };
	} catch (error) {
		logger.error(
			`Could not read the transcript result. Params: ${JSON.stringify(whisperBaseParams)}`,
		);
		throw error;
	}
};

const getLanguageCode = async (
	whisperBaseParams: WhisperBaseParams,
	whisperX: boolean,
): Promise<LanguageCode> => {
	if (whisperX) {
		return Promise.resolve('auto');
	}
	const dlParams = whisperParams(true, whisperBaseParams.wavPath);
	const { metadata } = await runWhisper(whisperBaseParams, dlParams);
	return (
		languageCodes.find((c) => c === metadata.detectedLanguageCode) || 'auto'
	);
};

const transcribeAndTranslate = async (
	whisperBaseParams: WhisperBaseParams,
	whisperX: boolean,
): Promise<TranscriptionResult> => {
	try {
		const languageCode = await getLanguageCode(whisperBaseParams, whisperX);
		const transcription = await runTranscription(
			whisperBaseParams,
			languageCode,
			false,
			whisperX,
		);

		// we only run language detection once,
		// so need to override the detected language of future whisper runs
		transcription.metadata.detectedLanguageCode = languageCode;
		const translation =
			languageCode === 'en'
				? null
				: await runTranscription(
						whisperBaseParams,
						languageCode,
						true,
						whisperX,
					);
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
		);
		throw error;
	}
};

export const getTranscriptionText = async (
	whisperBaseParams: WhisperBaseParams,
	languageCode: LanguageCode,
	translate: boolean,
	combineTranscribeAndTranslate: boolean,
	whisperX: boolean,
): Promise<TranscriptionResult> => {
	if (combineTranscribeAndTranslate) {
		return transcribeAndTranslate(whisperBaseParams, whisperX);
	}
	return runTranscription(whisperBaseParams, languageCode, translate, whisperX);
};

const regexExtract = (text: string, regex: RegExp): string | undefined => {
	const regexResult = text.match(regex);
	return regexResult ? regexResult[1] : undefined;
};

const extractWhisperXStderrData = (stderr: string): TranscriptionMetadata => {
	//Detected language: en (0.99) in first 30s of audio...
	const languageRegex = /Detected language: ([a-zA-Z]{2})/;
	const detectedLanguageCode = regexExtract(stderr, languageRegex);
	return { detectedLanguageCode };
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
		detectedLanguageCode: detectedLanguageCode,
		loadTimeMs: loadTime ? parseInt(loadTime) : undefined,
		totalTimeMs: totalTime ? parseInt(totalTime) : undefined,
	};
};

const whisperParams = (
	detectLanguageOnly: boolean,
	file: string,
	languageCode: LanguageCode = 'auto',
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
	languageCode: LanguageCode,
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
			'--output_dir',
			path.parse(wavPath).dir,
			wavPath,
		]);
		const metadata = extractWhisperXStderrData(result.stderr);
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
