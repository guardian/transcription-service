import fs from 'node:fs';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';
import { logger } from '@guardian/transcription-service-backend-common';
import {
	MediaDownloadFailureReason,
	MediaMetadata,
	YoutubeEventDynamoItem,
} from '@guardian/transcription-service-common';

type YtDlpSuccess = {
	status: 'SUCCESS';
	metadata: MediaMetadata;
};

type YtDlpFailure = {
	errorType: MediaDownloadFailureReason;
	status: 'FAILURE';
};

export const isSuccess = (
	result: YtDlpSuccess | YtDlpFailure,
): result is YtDlpSuccess => result.status === 'SUCCESS';

export const isFailure = (
	result: YtDlpSuccess | YtDlpFailure,
): result is YtDlpFailure => result.status === 'FAILURE';

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

export type ProxyData = {
	ip: string;
	port: number;
};

export const startProxyTunnels = async (
	key: string,
	proxyData: ProxyData[],
	workingDirectory: string,
): Promise<string[]> => {
	try {
		fs.writeFileSync(`${workingDirectory}/media_download`, key + '\n', {
			mode: 0o600,
		});
		const startedProxies: string[] = [];
		for (const proxy of proxyData) {
			const result = await runSpawnCommand(
				'startProxyTunnel',
				'ssh',
				[
					'-o',
					'IdentitiesOnly=yes',
					'-o',
					'StrictHostKeyChecking=no',
					'-D',
					proxy.port.toString(),
					// '-q',
					'-C',
					'-N',
					'-f',
					'-i',
					`${workingDirectory}/media_download`,
					`media_download@${proxy.ip}`,
				],
				true,
			);
			console.log(`Proxy result code for ${proxy.ip}: `, result.code);
			startedProxies.push(`socks5h://localhost:${proxy.port}`);
		}
		return startedProxies;
	} catch (error) {
		logger.error('Failed to start proxy tunnel', error);
		throw error;
	}
};

// We store success/bot block youtube events to indicate the likelihood of future
// youtube jobs succeeding
export const getYoutubeEvent = (
	url: string,
	status: 'SUCCESS' | MediaDownloadFailureReason,
	id: string,
): YoutubeEventDynamoItem | undefined => {
	const youtubeMatch = url.includes('youtube.com');
	if (youtubeMatch && (status === 'SUCCESS' || status === 'BOT_BLOCKED')) {
		return {
			id,
			eventTime: `${new Date().toISOString()}`,
			status,
		};
	}
	return undefined;
};

export const downloadMedia = async (
	url: string,
	workingDirectory: string,
	id: string,
	proxyUrls?: string[],
): Promise<YtDlpSuccess | YtDlpFailure> => {
	const nextProxy =
		proxyUrls && proxyUrls.length > 0 ? proxyUrls[0] : undefined;
	const proxyParams = nextProxy ? ['--proxy', nextProxy] : [];
	try {
		const filepathLocation = `${workingDirectory}/${id}.txt`;
		// yt-dlp --print-to-file appends to the file, so wipe it first
		fs.writeFileSync(filepathLocation, '');
		const result = await runSpawnCommand(
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
				'--progress-delta',
				'10', //seconds
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
			false,
		);
		if (result.code && result.code !== 0) {
			logger.error(
				`yt-dlp failed with code ${result.code}, stderr: ${result.stderr}`,
			);
			if (result.stderr.includes('ERROR: Unsupported URL')) {
				return { errorType: 'INVALID_URL', status: 'FAILURE' };
			}
			if (result.stderr.includes('LOGIN_REQUIRED') && url.includes('youtube')) {
				if (proxyUrls && proxyUrls.length > 1) {
					return downloadMedia(url, workingDirectory, id, proxyUrls?.slice(1));
				}
				return { errorType: 'BOT_BLOCKED', status: 'FAILURE' };
			} else {
				return { errorType: 'FAILURE', status: 'FAILURE' };
			}
		}

		const outputPath = fs.readFileSync(filepathLocation, 'utf8').trim();
		const metadata = extractInfoJson(
			`${workingDirectory}/${id}.info.json`,
			outputPath,
		);
		logger.info(
			`Download complete, extracted metadata: ${JSON.stringify(metadata)}`,
		);

		return {
			metadata,
			status: 'SUCCESS',
		};
	} catch (error) {
		logger.error(`Failed to download ${url}`, error);
		return { errorType: 'FAILURE', status: 'FAILURE' };
	}
};
