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
	const getBlob = (file: string) => new Blob([file as BlobPart]);
	const blobs: [string, string, Blob][] = [
		['srt', destinationBucketUrls.srt.url, getBlob(files.srt)],
		['json', destinationBucketUrls.zip.url, getBlob(files.json)],
		['text', destinationBucketUrls.text.url, getBlob(files.text)],
	];

	const zipBlob = await getZipBlob(files);

	console.log(`zipBlob.type: ${zipBlob.type}`);

	for (const blobDetail of blobs) {
		const [fileFormat, url, blob] = blobDetail;

		const blobTest = blobDetail[0] === 'json' ? zipBlob : blob;

		if (blobDetail[0] === 'json') {
			console.log(`s3 url is: ${url}`);
		}
		const response = await uploadToS3(url, blobTest);

		if (!response.isSuccess) {
			throw new Error(
				`Could not upload file format: ${fileFormat} to S3! ${response.errorMsg}`,
			);
		}
		logger.info(`Successfully uploaded file format ${fileFormat} to S3`);
	}
};
