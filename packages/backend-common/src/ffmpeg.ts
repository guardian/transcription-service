import { exec } from 'node:child_process';
import { logger } from '@guardian/transcription-service-backend-common';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

export const getFileDuration = async (filePath: string): Promise<number> => {
	const command = `ffprobe -i ${filePath} -show_entries format=duration -v quiet -of csv="p=0"`;
	try {
		const { stdout, stderr } = await execPromise(command);
		if (stderr) {
			logger.error(` ffprobe stderr: `, stderr);
		}
		return parseFloat(stdout);
	} catch (error) {
		logger.error(`Error during ffprobe file duration detection`, error);
		throw error;
	}
};
