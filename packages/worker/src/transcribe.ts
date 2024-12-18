import path from 'path';
import { readFile } from '@guardian/transcription-service-backend-common';
import { logger } from '@guardian/transcription-service-backend-common';
import {
	LanguageCode,
	languageCodes,
} from '@guardian/transcription-service-common';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';

interface FfmpegResult {
	wavPath: string;
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
	containerId: string;
	wavPath: string;
	file: string;
	numberOfThreads: number;
	model: WhisperModel;
};

const CONTAINER_FOLDER = '/input';

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

export const convertToWav = async (
	containerId: string,
	file: string,
): Promise<FfmpegResult | undefined> => {
	const fileName = path.basename(file);
	const filePath = `${CONTAINER_FOLDER}/${fileName}`;
	const wavPath = `${CONTAINER_FOLDER}/${fileName}-converted.wav`;
	logger.info(`containerId: ${containerId}`);
	logger.info(`file path: ${filePath}`);
	logger.info(`wav file path: ${wavPath}`);

	try {
		const res = await runSpawnCommand(
			'convertToWav',
			'docker',
			[
				'exec',
				containerId,
				'ffmpeg',
				'-y',
				'-i',
				filePath,
				'-ar',
				'16000',
				'-ac',
				'1',
				'-c:a',
				'pcm_s16le',
				wavPath,
			],
			true,
		);

		const duration = getDuration(res.stderr);

		return {
			wavPath,
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
) => {
	try {
		const params = whisperParams(
			false,
			whisperBaseParams.wavPath,
			languageCode,
			translate,
		);
		const { fileName, metadata } = await runWhisper(whisperBaseParams, params);

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

const transcribeAndTranslate = async (
	whisperBaseParams: WhisperBaseParams,
): Promise<TranscriptionResult> => {
	try {
		const dlParams = whisperParams(true, whisperBaseParams.wavPath);
		const { metadata } = await runWhisper(whisperBaseParams, dlParams);
		const languageCode =
			languageCodes.find((c) => c === metadata.detectedLanguageCode) || 'auto';
		const transcription = await runTranscription(
			whisperBaseParams,
			languageCode,
			false,
		);

		// we only run language detection once,
		// so need to override the detected language of future whisper runs
		transcription.metadata.detectedLanguageCode = metadata.detectedLanguageCode;
		const translation =
			languageCode === 'en'
				? null
				: await runTranscription(whisperBaseParams, languageCode, true);
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
): Promise<TranscriptionResult> => {
	if (combineTranscribeAndTranslate) {
		return transcribeAndTranslate(whisperBaseParams);
	}
	return runTranscription(whisperBaseParams, languageCode, translate);
};

const regexExtract = (text: string, regex: RegExp): string | undefined => {
	const regexResult = text.match(regex);
	return regexResult ? regexResult[1] : undefined;
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

export const runWhisper = async (
	whisperBaseParams: WhisperBaseParams,
	whisperParams: string[],
) => {
	const { containerId, numberOfThreads, model, wavPath } = whisperBaseParams;
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
