import { logger } from '@guardian/transcription-service-backend-common';
import { TranscriptionResult, Transcripts } from './transcribe';
import {
	uploadToS3,
	type OutputBucketUrls,
} from '@guardian/transcription-service-common';

export const uploadAllTranscriptsToS3 = async (
	destinationBucketUrls: OutputBucketUrls,
	files: Transcripts,
) => {
	const getBlob = (file: string) => new Blob([file as BlobPart]);
	const blobs: [string, string, Blob][] = [
		['srt', destinationBucketUrls.srt.url, getBlob(files.srt)],
		['json', destinationBucketUrls.json.url, getBlob(files.json)],
		['text', destinationBucketUrls.text.url, getBlob(files.text)],
	];

	for (const blobDetail of blobs) {
		const [fileFormat, url, blob] = blobDetail;
		const response = await uploadToS3(url, blob);
		if (!response.isSuccess) {
			throw new Error(
				`Could not upload file format: ${fileFormat} to S3! ${response.errorMsg}`,
			);
		}
		logger.info(`Successfully uploaded file format ${fileFormat} to S3`);
	}
};

export const uploadedCombinedResultsToS3 = async (
	combinedOutputUrl: string,
	result: TranscriptionResult,
) => {
	const blob = new Blob([JSON.stringify(result) as BlobPart]);
	const response = await uploadToS3(combinedOutputUrl, blob);
	if (!response.isSuccess) {
		throw new Error(
			`Could not upload combined results to S3! ${response.errorMsg}`,
		);
	}
	logger.info(`Successfully uploaded combined results to S3`);
};
