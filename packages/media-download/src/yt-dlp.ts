import fs from 'node:fs';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';
import { logger } from '@guardian/transcription-service-backend-common';
import { MEDIA_DOWNLOAD_WORKING_DIRECTORY } from './index';
import path from 'path';

export type MediaMetadata = {
	title: string;
	extension: string;
	filename: string;
	mediaPath: string;
	duration: number;
};

const extractInfoJson = (
	infoJsonPath: string,
	outputFilePath: string,
): MediaMetadata => {
	const file = fs.readFileSync(infoJsonPath, 'utf8');
	const json = JSON.parse(file);
	return {
		title: json.title,
		extension: json.ext,
		filename: path.basename(outputFilePath),
		mediaPath: `${json.filename}`,
		duration: parseInt(json.duration),
	};
};

export const startProxyTunnel = async (
	key: string,
	ip: string,
	port: number,
): Promise<string> => {
	try {
		fs.writeFileSync(
			`${MEDIA_DOWNLOAD_WORKING_DIRECTORY}/media_download`,
			key + '\n',
			{ mode: 0o600 },
		);
		const result = await runSpawnCommand(
			'startProxyTunnel',
			'ssh',
			[
				'-o',
				'IdentitiesOnly=yes',
				'-o',
				'StrictHostKeyChecking=no',
				'-D',
				port.toString(),
				// '-q',
				'-C',
				'-N',
				'-f',
				'-i',
				`${MEDIA_DOWNLOAD_WORKING_DIRECTORY}/media_download`,
				`media_download@${ip}`,
			],
			true,
		);
		console.log('Proxy result code: ', result.code);
		return `socks5h://localhost:${port}`;
	} catch (error) {
		logger.error('Failed to start proxy tunnel', error);
		throw error;
	}
};

export const downloadMedia = async (
	url: string,
	destinationDirectoryPath: string,
	id: string,
	proxyUrl?: string,
) => {
	const proxyParams = proxyUrl ? ['--proxy', proxyUrl] : [];
	try {
		const filepathLocation = `${destinationDirectoryPath}/${id}.txt`;
		await runSpawnCommand(
			'downloadMedia',
			'yt-dlp',
			[
				'--write-info-json',
				'--no-clean-info-json',
				`--print-to-file after_move:filepath ${filepathLocation}`,
				'--newline',
				'-o',
				`${destinationDirectoryPath}/${id}.%(ext)s`,
				...proxyParams,
				url,
			],
			true,
		);
		const outputPath = fs.readFileSync(filepathLocation, 'utf8').trim();
		const metadata = extractInfoJson(
			`${destinationDirectoryPath}/${id}.info.json`,
			outputPath,
		);

		return metadata;
	} catch (error) {
		logger.error(`Failed to download ${url}`, error);
		return null;
	}
};
