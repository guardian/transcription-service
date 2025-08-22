import { logger } from '@guardian/transcription-service-backend-common';
import {
	uploadToS3,
	type OutputBucketUrls,
	Transcripts,
	TranscriptionResult,
} from '@guardian/transcription-service-common';
import { gzip } from 'node-gzip';

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
		const response = await uploadToS3(url, blob, false);
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
	const gzippedResult: Buffer = await gzip(JSON.stringify(result));
	// const blob = new Blob([gzippedResult as BlobPart]);
	const response = await uploadToS3(combinedOutputUrl, gzippedResult, true);
	if (!response.isSuccess) {
		throw new Error(
			`Could not upload combined results to S3! ${response.errorMsg}`,
		);
	}
	logger.info(`Successfully uploaded combined results to S3`);
};
