import fs from 'node:fs';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';
import { logger } from '@guardian/transcription-service-backend-common';
import { MediaMetadata } from '@guardian/transcription-service-common';

const extractInfoJson = (
	infoJsonPath: string,
	outputFilePath: string,
): MediaMetadata => {
	const file = fs.readFileSync(infoJsonPath, 'utf8');
	const json = JSON.parse(file);
	return {
		title: json.title,
		extension: json.ext || json.entries[0]?.ext,
		mediaPath: outputFilePath,
		duration: parseInt(json.duration),
	};
};

export const startProxyTunnel = async (
	key: string,
	ip: string,
	port: number,
	workingDirectory: string,
): Promise<string> => {
	try {
		fs.writeFileSync(`${workingDirectory}/media_download`, key + '\n', {
			mode: 0o600,
		});
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
				`${workingDirectory}/media_download`,
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
	workingDirectory: string,
	id: string,
	proxyUrl?: string,
) => {
	const proxyParams = proxyUrl ? ['--proxy', proxyUrl] : [];
	try {
		const filepathLocation = `${workingDirectory}/${id}.txt`;
		// yt-dlp --print-to-file appends to the file, so wipe it first
		fs.writeFileSync(filepathLocation, '');
		await runSpawnCommand(
			'downloadMedia',
			'yt-dlp',
			[
				'-v',
				'-S',
				'ext', // prefer mp4 format - see https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#format-selection-examples
				'--extractor-args',
				'youtubepot-bgutilscript:script_path=/opt/bgutil-ytdlp-pot-provider/server/build/generate_once.js',
				'--write-info-json',
				'--no-clean-info-json',
				'--print-to-file',
				'after_move:filepath',
				`${filepathLocation}`,
				'--newline',
				'-o',
				`${workingDirectory}/${id}.%(ext)s`,
				...proxyParams,
				url,
			],
			true,
		);
		const outputPath = fs.readFileSync(filepathLocation, 'utf8').trim();
		const metadata = extractInfoJson(
			`${workingDirectory}/${id}.info.json`,
			outputPath,
		);
		logger.info(
			`Download complete, extracted metadata: ${JSON.stringify(metadata)}`,
		);

		return metadata;
	} catch (error) {
		logger.error(`Failed to download ${url}`, error);
		return null;
	}
};
