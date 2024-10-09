import fs from 'node:fs';
import { runSpawnCommand } from '@guardian/transcription-service-backend-common/src/process';

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

export const downloadMedia = async (
	url: string,
	destinationDirectoryPath: string,
	id: string,
) => {
	const output = await runSpawnCommand('downloadMedia', 'yt-dlp', [
		'--write-info-json',
		'--no-clean-info-json',
		'--newline',
		'-o',
		`${destinationDirectoryPath}/${id}`,
		url,
		false,
	]);
	console.log(output);
	const metadata = extractInfoJson(
		`${destinationDirectoryPath}/${id}.info.json`,
	);

	return metadata;
};
