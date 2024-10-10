import { spawn } from 'child_process';
import { logger } from './logging';
export interface ProcessResult {
	code?: number;
	stdout: string;
	stderr: string;
}

export const runSpawnCommand = (
	processName: string,
	cmd: string,
	args: ReadonlyArray<string>,
	logStdout: boolean,
	logImmediately: boolean = false,
): Promise<ProcessResult> => {
	return new Promise((resolve, reject) => {
		const cp = spawn(cmd, args);
		const stdout: string[] = [];
		const stderr: string[] = [];
		cp.stdout.on('data', (data) => {
			stdout.push(data.toString());
			if (logImmediately) {
				logger.info(data.toString());
			}
		});

		cp.stderr.on('data', (data) => {
			stderr.push(data.toString());
			if (logImmediately) {
				logger.error(data.toString());
			}
		});

		cp.on('error', (e) => {
			stderr.push(e.toString());
			if (logImmediately) {
				logger.error(data.toString());
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
