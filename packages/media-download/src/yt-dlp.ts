import fs from 'node:fs';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';
import { logger } from '@guardian/transcription-service-backend-common';
import {
	MediaDownloadFailureReason,
	MediaMetadata,
} from '@guardian/transcription-service-common';

export type YtDlpSuccess = {
	status: 'SUCCESS';
	metadata: MediaMetadata;
};

export type YtDlpFailure = {
	errorType: MediaDownloadFailureReason;
	status: 'FAILURE';
	cookiesExpired?: boolean;
};

export const isSuccess = (
	result: YtDlpSuccess | YtDlpFailure,
): result is YtDlpSuccess => result.status === 'SUCCESS';

export const isFailure = (
	result: YtDlpSuccess | YtDlpFailure,
): result is YtDlpFailure => result.status === 'FAILURE';

export const getYtDlpMetricDimension = (result: YtDlpRetryResult) => {
	if (isSuccess(result.result)) {
		return 'SUCCESS';
	}
	if (result.failures.some((failure) => failure.cookiesExpired)) {
		// it's useful in metrics to know when cookies have expired so we can alarm and update them
		return 'BOT_BLOCKED_COOKIES_EXPIRED';
	}
	return result.result.errorType;
};

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

export const downloadMedia = async (
	url: string,
	workingDirectory: string,
	id: string,
	cookieProxyParam: string[],
): Promise<YtDlpSuccess | YtDlpFailure> => {
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
				'--remote-components',
				'ejs:github',
				'--no-playlist', // we have no support for > 1 video currently
				'--progress-delta',
				'10', //seconds
				'--print-to-file',
				'after_move:filepath',
				`${filepathLocation}`,
				'--newline',
				'-o',
				`${workingDirectory}/${id}.%(ext)s`,
				...cookieProxyParam,
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
			if (
				url.includes('youtube') &&
				(result.stderr.includes('LOGIN_REQUIRED') ||
					result.stderr.includes('HTTP Error 403'))
			) {
				if (
					result.stderr.includes('YouTube account cookies are no longer valid')
				) {
					return {
						errorType: 'BOT_BLOCKED',
						status: 'FAILURE',
						cookiesExpired: true,
					};
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

export type YtDlpRetryResult = {
	result: YtDlpSuccess | YtDlpFailure;
	failures: Array<YtDlpFailure>;
};

export const downloadMediaWithRetry = async (
	url: string,
	workingDirectory: string,
	id: string,
	isYoutube: boolean,
	proxyUrls: string[],
	cookies?: string,
): Promise<YtDlpRetryResult> => {
	const failures: Array<YtDlpFailure> = [];
	// try downloading via proxies
	if (proxyUrls) {
		const proxyParams = proxyUrls.map((proxyUrl) => ['--proxy', proxyUrl]);
		for (const param of proxyParams) {
			logger.info(`Attempting to download media with ${param.join(' ')}`);
			const result = await downloadMedia(url, workingDirectory, id, param);

			if (isFailure(result)) {
				failures.push(result);
				// if we get bot blocked, try again with the next proxy
				if (result.errorType === 'BOT_BLOCKED') {
					continue;
				}
			}
			return { result, failures };
		}
	}

	if (isYoutube && cookies) {
		// Try logging in to perform the download
		const path = '/tmp/cookies.txt';
		fs.writeFileSync(path, cookies);
		const cookieParam = ['--cookies', path];
		logger.info(`Attempting to download media with cookies`);
		const result = await downloadMedia(url, workingDirectory, id, cookieParam);
		if (isSuccess(result)) {
			return { result, failures };
		} else {
			failures.push(result);
		}
	}
	// one last try with no proxy or cookies - download straight to the ecs container
	const result = await downloadMedia(url, workingDirectory, id, []);
	if (isFailure(result)) {
		failures.push(result);
	}
	return { result, failures };
};
