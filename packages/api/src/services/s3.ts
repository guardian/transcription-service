import {
	getFileFromS3,
	readFile,
	TranscriptionConfig,
	Transcripts,
} from '@guardian/transcription-service-backend-common';
import { OutputBucketKeys } from '@guardian/transcription-service-common';

export const getTranscriptsText = async (
	config: TranscriptionConfig,
	outputBucketKeys: OutputBucketKeys,
): Promise<Transcripts | undefined> => {
	try {
		const destinationDirectory =
			config.app.stage === 'DEV' ? `${__dirname}/sample` : '/tmp';
		const srtFile = await getFileFromS3(
			config.aws.region,
			destinationDirectory,
			config.app.transcriptionOutputBucket,
			outputBucketKeys.srt,
		);
		const jsonFile = await getFileFromS3(
			config.aws.region,
			destinationDirectory,
			config.app.transcriptionOutputBucket,
			outputBucketKeys.json,
		);
		const textFile = await getFileFromS3(
			config.aws.region,
			destinationDirectory,
			config.app.transcriptionOutputBucket,
			outputBucketKeys.text,
		);

		const srt = readFile(srtFile);
		const json = readFile(jsonFile);
		const text = readFile(textFile);

		const result: Transcripts = { srt, json, text };

		return result;
	} catch (error) {
		console.log(`failed to get transcription texts from S3`, error);
		return Promise.resolve(undefined);
	}
};
