import { exec, spawn } from 'child_process';
import util from 'node:util';
import path from 'path';

const asyncExec = util.promisify(exec);

interface ProcessResult {
	code?: number;
	stdout: string;
	stderr: string;
}

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

const createContainer = async (tempDir: string): Promise<string> => {
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
		`${tempDir}:/input`,
		'ghcr.io/guardian/transcription-service',
	]);
	return newContainer.stdout.trim();
};

export const convertToWav = async (
	containerId: string,
	path: string,
	tempDir: string,
) => {
	const wavPath = `${tempDir}/output.wav`;
	console.log(`containerId: ${containerId}`);
	console.log('original file path: ', path);
	console.log('wav file path: ', wavPath);

	try {
		console.log('calling ffmpeg');
		await runSpawnCommand('docker', [
			'exec',
			containerId,
			'ffmpeg',
			'-y',
			'-i',
			path,
			'-ar',
			'16000',
			'-ac',
			'1',
			'-c:a',
			'pcm_s16le',
			wavPath,
		]);

		return wavPath;
	} catch (error) {
		console.log('ffmpeg failed error:', error);
		throw error;
	}
};

export const convertAndTranscribe = async (file: string) => {
	const fileName = path.basename(file);
	const containerId = await createContainer(path.parse(file).dir);

	const wavPath = await convertToWav(
		containerId,
		`/input/${fileName}`,
		'/input',
	);

	await transcribe(containerId, wavPath, '/input');
};

const transcribe = async (
	containerId: string,
	file: string,
	tmpDir: string,
) => {
	const outputFile = path.resolve(tmpDir, path.parse(file).name);
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
			'--output-txt',
			'--output-file',
			outputFile,
			'--language',
			'auto',
		]);
		console.log('Transcription finished successfully');
	} catch (error) {
		console.log(`transcribe failed due to `, error);
		throw error;
	}
};
