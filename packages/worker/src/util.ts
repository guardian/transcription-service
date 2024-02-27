import { logger } from '@guardian/transcription-service-backend-common/src/logging';
import { Transcripts } from './transcribe';
import {
	uploadToS3,
	type OutputBucketUrls,
} from '@guardian/transcription-service-common';
import path from 'path';

export const uploadAllTranscriptsToS3 = async (
	destinationBucketUrls: OutputBucketUrls,
	files: Transcripts,
) => {
	const getBlob = (file: string) => new Blob([file as BlobPart]);
	const getFileName = (file: string) => path.basename(file);
	const blobs: [string, string, Blob][] = [
		[getFileName(files.srt), destinationBucketUrls.srt.url, getBlob(files.srt)],
		[
			getFileName(files.json),
			destinationBucketUrls.json.url,
			getBlob(files.json),
		],
		[
			getFileName(files.text),
			destinationBucketUrls.text.url,
			getBlob(files.text),
		],
	];

	for (const blobDetail of blobs) {
		const [fileName, url, blob] = blobDetail;
		const response = await uploadToS3(url, blob);
		if (!response.isSuccess) {
			throw new Error(
				`Could not upload file: ${fileName} to S3! ${response.errorMsg}`,
			);
		}
		logger.info(`Successfully uploaded ${fileName} to S3`);
	}
};
