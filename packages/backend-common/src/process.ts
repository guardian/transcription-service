import { spawn } from 'child_process';
import { logger } from './logging';
export interface ProcessResult {
	code?: number;
	stdout: string;
	stderr: string;
}

export type ProcessName =
	| 'transcribe'
	| 'transcribe-whisperx'
	| 'convertToWav'
	| 'startProxyTunnel'
	| 'downloadMedia'
	| 'getContainer'
	| 'createNewContainer';

const processesWithHiddenStdout: ProcessName[] = ['transcribe'];

export const runSpawnCommand = (
	processName: ProcessName,
	cmd: string,
	args: ReadonlyArray<string>,
	logImmediately: boolean = false,
	maybeLoggingCallback?: (
		data: { stdout: string } | { stderr: string },
	) => void,
): Promise<ProcessResult> => {
	logger.info(
		`Running process ${processName} with command: ${cmd} ${args.join(' ')}`,
	);
	const logStdout = !processesWithHiddenStdout.includes(processName);
	return new Promise((resolve, reject) => {
		const cp = spawn(cmd, args);
		const stdout: string[] = [];
		const stderr: string[] = [];
		cp.stdout.on('data', (data) => {
			const str = data.toString();
			stdout.push(str);
			if (logImmediately && logStdout) {
				logger.info(str);
			}
			maybeLoggingCallback?.({ stdout: str });
		});

		cp.stderr.on('data', (data) => {
			const str = data.toString();
			stderr.push(str);
			if (logImmediately) {
				// ffmpeg sends all text output to stderr even when it's successful
				logger.info(str);
			}
			maybeLoggingCallback?.({ stderr: str });
		});

		cp.on('error', (e) => {
			stderr.push(e.toString());
			if (logImmediately) {
				logger.error(e.toString());
			}
		});

		cp.on('close', (code) => {
			const result = {
				stdout: stdout.join(''),
				stderr: stderr.join(''),
				code: code || undefined,
			};
			if (logStdout) {
				logger.info(
					`process ${processName} stdout: ${result.stdout} stderr: ${result.stderr}`,
				);
			} else {
				logger.info('Logging stderr only');
				logger.info(`process ${processName} stderr: ${result.stderr}`);
			}
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
