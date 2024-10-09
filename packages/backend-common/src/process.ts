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
