import { exec, spawn } from 'child_process';
import util from 'node:util';
import path from 'path';
import * as fs from 'fs';

const asyncExec = util.promisify(exec);

interface ProcessResult {
	code?: number;
	stdout: string;
	stderr: string;
}

interface FfmpegResult {
	wavPath: string;
	duration?: number;
}

const CONTAINER_FOLDER = '/input';

export const runSpawnCommand = (
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

export const runExecCommand = async (command: string): Promise<string> => {
	try {
		const { stdout, stderr } = await asyncExec(command);
		if (stderr) {
			throw new Error(stderr);
		}
		return Promise.resolve(stdout);
	} catch (ex) {
		console.log(`error:`, ex);
		throw ex;
	}
};

export const createContainer = async (tempDir: string): Promise<string> => {
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
	const wavPath = `${CONTAINER_FOLDER}/output.wav`;
	console.log(`containerId: ${containerId}`);
	console.log('file path: ', filePath);
	console.log('wav file path: ', wavPath);

	try {
		console.log('calling ffmpeg');
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
	console.log(`calculated file duration is ${duration} seconds`);
	return duration;
};

const readFile = (filePath: string): string => {
	const file = fs.readFileSync(filePath, 'utf8');
	return file;
};

export const getTranscriptionText = async (
	containerId: string,
	wavPath: string,
	file: string,
) => {
	const resultFile = await transcribe(containerId, wavPath);
	const transcriptText = readFile(
		path.resolve(path.parse(file).dir, resultFile),
	);
	return transcriptText;
};

const transcribe = async (containerId: string, file: string) => {
	const outputFile = path.resolve(CONTAINER_FOLDER, path.parse(file).name);
	console.log(`transcribe outputFile: ${outputFile}`);

	try {
		await runSpawnCommand('docker', [
			'exec',
			containerId,
			'whisper.cpp/main',
			'-m',
			'whisper.cpp/models/ggml-medium.bin',
			'-f',
			file,
			'--output-srt',
			'--output-file',
			outputFile,
			'--language',
			'auto',
		]);
		console.log('Transcription finished successfully');
		return `${path.parse(file).name}.srt`;
	} catch (error) {
		console.log(`Transcription failed due to `, error);
		throw error;
	}
};
