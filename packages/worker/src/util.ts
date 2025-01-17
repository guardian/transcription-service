import { logger } from '@guardian/transcription-service-backend-common';
import { Transcripts } from './transcribe';
import {
	uploadToS3,
	type OutputBucketUrls,
} from '@guardian/transcription-service-common';
import { getZipBlob } from '@guardian/transcription-service-backend-common/src/zip';

export const uploadAllTranscriptsToS3 = async (
	destinationBucketUrls: OutputBucketUrls,
	files: Transcripts,
) => {
	const zipBlob = await getZipBlob(files);
	const blobs: [string, string, Blob][] = [
		['zip', destinationBucketUrls.zip.url, zipBlob],
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
