import fs from 'node:fs';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';
import { logger } from '@guardian/transcription-service-backend-common';

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
		mediaPath: `${json.filename}.${json.ext}`,
	};
};

export const startProxyTunnel = async (key: string, ip: string) => {
	try {
		fs.writeFileSync('/tmp/media_download', key + '\n', { mode: 0o600 });
		const result = await runSpawnCommand(
			'startProxyTunnel',
			'ssh',
			[
				'-o',
				'IdentitiesOnly=yes',
				'-o',
				'StrictHostKeyChecking=no',
				'-D',
				'1337',
				// '-q',
				'-C',
				'-N',
				'-f',
				'-i',
				'/tmp/media_download',
				`media_download@${ip}`,
			],
			true,
			true,
		);
		console.log('Proxy result code: ', result.code);
		return true;
	} catch (error) {
		logger.error('Failed to start proxy tunnel', error);
		throw error;
	}
};

export const downloadMedia = async (
	url: string,
	destinationDirectoryPath: string,
	id: string,
	useProxy: boolean,
) => {
	const proxyParams = useProxy ? ['--proxy', 'socks5h://localhost:1337'] : [];
	try {
		await runSpawnCommand(
			'downloadMedia',
			'yt-dlp',
			[
				'--write-info-json',
				'--no-clean-info-json',
				'--newline',
				'-o',
				`${destinationDirectoryPath}/${id}`,
				...proxyParams,
				url,
			],
			true,
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
