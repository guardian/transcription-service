import { spawn } from 'child_process';
import path from 'path';
import { readFile } from '@guardian/transcription-service-backend-common';
import { logger } from '@guardian/transcription-service-backend-common';
import { LanguageCode } from '@guardian/transcription-service-common';

interface ProcessResult {
	code?: number;
	stdout: string;
	stderr: string;
}

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
	metadata: TranscriptionMetadata;
};

const CONTAINER_FOLDER = '/input';

const runSpawnCommand = (
	processName: string,
	cmd: string,
	args: ReadonlyArray<string>,
): Promise<ProcessResult> => {
	return new Promise((resolve, reject) => {
		const cp = spawn(cmd, args);
		const stdout: string[] = [];
		const stderr: string[] = [];
		cp.stdout.on('data', (data) => {
			stdout.push(data.toString());
		});

		cp.stderr.on('data', (data) => {
			stderr.push(data.toString());
		});

		cp.on('error', (e) => {
			stderr.push(e.toString());
		});

		cp.on('close', (code) => {
			const result = {
				stdout: stdout.join(''),
				stderr: stderr.join(''),
				code: code || undefined,
			};
			logger.info('Ignoring stdout to avoid logging sensitive data');
			logger.info(`process ${processName} stderr: ${result.stderr}`);
			if (code === 0) {
				resolve(result);
			} else {
				logger.error(
					`process ${processName} failed with code ${result.code} due to: ${result.stderr}`,
				);
				reject(result);
			}
		});
	});
};

export const getOrCreateContainer = async (
	tempDir: string,
): Promise<string> => {
	const existingContainer = await runSpawnCommand('getContainer', 'docker', [
		'ps',
		'--filter',
		'name=whisper',
		'--format',
		'{{.ID}}',
	]);

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
		const res = await runSpawnCommand('convertToWav', 'docker', [
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
		]);

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

export const getTranscriptionText = async (
	containerId: string,
	wavPath: string,
	file: string,
	numberOfThreads: number,
	model: WhisperModel,
	languageCode: LanguageCode | null,
): Promise<TranscriptionResult> => {
	try {
		const { fileName, metadata } = await transcribe(
			containerId,
			wavPath,
			numberOfThreads,
			model,
			languageCode,
		);

		const srtPath = path.resolve(path.parse(file).dir, `${fileName}.srt`);
		const textPath = path.resolve(path.parse(file).dir, `${fileName}.txt`);
		const jsonPath = path.resolve(path.parse(file).dir, `${fileName}.json`);

		const transcripts = {
			srt: readFile(srtPath),
			text: readFile(textPath),
			json: readFile(jsonPath),
		};

		return { transcripts, metadata };
	} catch (error) {
		logger.error(`Could not read the transcripts result`);
		throw error;
	}
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

export const transcribe = async (
	containerId: string,
	file: string,
	numberOfThreads: number,
	model: WhisperModel,
	languageCode: LanguageCode | null,
) => {
	const fileName = path.parse(file).name;
	const containerOutputFilePath = path.resolve(CONTAINER_FOLDER, fileName);
	logger.info(`Transcription output file path: ${containerOutputFilePath}`);
	const language = languageCode ? languageCode : 'auto';

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
			file,
			'--output-srt',
			'--output-txt',
			'--output-json',
			'--output-file',
			containerOutputFilePath,
			'--language',
			language,
		]);
		const metadata = extractWhisperStderrData(result.stderr);
		logger.info('Transcription finished successfully', metadata);
		return { fileName, metadata };
	} catch (error) {
		logger.error(`Transcription failed due to `, error);
		throw error;
	}
};
