import fs from 'node:fs';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';
import { logger } from '@guardian/transcription-service-backend-common';
import { MEDIA_DOWNLOAD_WORKING_DIRECTORY } from './index';

export type MediaMetadata = {
	title: string;
	extension: string;
	filename: string;
	mediaPath: string;
};

const extractInfoJson = (infoJsonPath: string): MediaMetadata => {
	const file = fs.readFileSync(infoJsonPath, 'utf8');
	const json = JSON.parse(file);
	return {
		title: json.title,
		extension: json.ext,
		filename: json.filename,
		mediaPath: `${json.filename}`,
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
		await runSpawnCommand(
			'downloadMedia',
			'yt-dlp',
			[
				'--write-info-json',
				'--no-clean-info-json',
				'--newline',
				'-o',
				`${destinationDirectoryPath}/${id}.%(ext)s`,
				...proxyParams,
				url,
			],
			true,
		);
		const metadata = extractInfoJson(
			`${destinationDirectoryPath}/${id}.info.json`,
		);

		return metadata;
	} catch (error) {
		logger.error(`Failed to download ${url}`, error);
		return null;
	}
};
