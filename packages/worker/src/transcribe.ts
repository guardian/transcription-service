import { spawn } from 'child_process';
import path from 'path';
// import { readFile } from './util';

interface ProcessResult {
	code?: number;
	stdout: string;
	stderr: string;
}

interface FfmpegResult {
	wavPath: string;
	duration?: number;
}

export interface Transcripts {
	srt: string;
	text: string;
	json: string;
}

const CONTAINER_FOLDER = '/input';

const runSpawnCommand = (
	cmd: string,
	args: ReadonlyArray<string>,
): Promise<ProcessResult> => {
	return new Promise((resolve, reject) => {
		const cp = spawn(cmd, args);
		const stdout: string[] = [];
		const stderr: string[] = [];
		cp.stdout.on('data', (data) => {
			console.log(data.toString());
			stdout.push(data.toString());
		});

		cp.stderr.on('data', (data) => {
			console.log(data.toString());
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
			if (code === 0) {
				resolve(result);
			} else {
				console.error(
					`failed with code ${result.code} due to: ${result.stderr}`,
				);
				reject(result);
			}
		});
	});
};

export const getOrCreateContainer = async (
	tempDir: string,
): Promise<string> => {
	const existingContainer = await runSpawnCommand('docker', [
		'ps',
		'--filter',
		'name=whisper',
		'--format',
		'{{.ID}}',
	]);

	if (existingContainer.stdout) {
		return existingContainer.stdout.trim();
	}

	const newContainer = await runSpawnCommand('docker', [
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
): Promise<FfmpegResult> => {
	const fileName = path.basename(file);
	const filePath = `${CONTAINER_FOLDER}/${fileName}`;
	const wavPath = `${CONTAINER_FOLDER}/${fileName}-converted.wav`;
	console.log(`containerId: ${containerId}`);
	console.log('file path: ', filePath);
	console.log('wav file path: ', wavPath);

	try {
		const res = await runSpawnCommand('docker', [
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
		console.log('ffmpeg failed error:', error);
		throw error;
	}
};

const getDuration = (ffmpegOutput: string) => {
	const reg = /Duration: (\d{1,2}):(\d{1,2}):(\d{1,2}).\d{1,2},/.exec(
		ffmpegOutput,
	);
	if (!reg || reg.length < 4) {
		console.warn('Could not retrieve duration from the ffmpeg result.');
		return undefined;
	}
	const hour = reg[1] ? parseInt(reg[1]) : 0;
	const minute = reg[2] ? parseInt(reg[2]) : 0;
	const seconds = reg[3] ? parseInt(reg[3]) : 0;
	const duration = hour * 3600 + minute * 60 + seconds;
	console.log(`File duration is ${duration} seconds`);
	return duration;
};

export const getTranscriptionText = async (
	containerId: string,
	wavPath: string,
	file: string,
	numberOfThreads: number,
): Promise<Transcripts> => {
	console.log(`my original file: ${file}`);
	const resultFile = await transcribe(containerId, wavPath, numberOfThreads);
	console.log(`result file: ${path.resolve(path.parse(file).dir, resultFile)}`);
	// const transcriptText = readFile(
	// 	path.resolve(path.parse(file).dir, resultFile),
	// );

	const res = {
		srt: path.resolve(path.parse(file).dir, `${resultFile}.srt`),
		text: path.resolve(path.parse(file).dir, `${resultFile}.txt`),
		json: path.resolve(path.parse(file).dir, `${resultFile}.json`),
	};

	console.log('transcribe all files: ');
	console.log(res);

	return res;
};

export const transcribe = async (
	containerId: string,
	file: string,
	numberOfThreads: number,
) => {
	const fileName = path.parse(file).name;
	const containerOutputFilePath = path.resolve(CONTAINER_FOLDER, fileName);
	console.log(`transcribe outputFile: ${containerOutputFilePath}`);

	try {
		await runSpawnCommand('docker', [
			'exec',
			containerId,
			'whisper.cpp/main',
			'--model',
			'whisper.cpp/models/ggml-medium.bin',
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
			'auto',
		]);
		console.log('Transcription finished successfully');
		console.log(`transcript result: ${fileName}`);
		return fileName;
	} catch (error) {
		console.log(`Transcription failed due to `, error);
		throw error;
	}
};
