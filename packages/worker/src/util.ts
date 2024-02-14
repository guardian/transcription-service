import * as fs from 'fs';
import { Transcripts } from './transcribe';
import {
	uploadToS3,
	type OutputBucketUrls,
} from '@guardian/transcription-service-common';
import {
	getFile,
	getS3Client,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import path from 'path';

export const readFile = (filePath: string): string => {
	const file = fs.readFileSync(filePath, 'utf8');
	return file;
};

export const uploadAllTranscriptsToS3 = async (
	destinationBucketUrls: OutputBucketUrls,
	files: Transcripts,
) => {
	const getBlob = (file: string) => new Blob([file as BlobPart]);
	const getFileName = (file: string) => path.basename(file);
	const blobs: [string, string, Blob][] = [
		[getFileName(files.srt), destinationBucketUrls.srt, getBlob(files.srt)],
		[getFileName(files.json), destinationBucketUrls.json, getBlob(files.json)],
		[getFileName(files.text), destinationBucketUrls.text, getBlob(files.text)],
	];

	for (const blobDetail of blobs) {
		const [fileName, url, blob] = blobDetail;
		const response = await uploadToS3(url, blob);
		if (!response) {
			throw new Error(`Could not upload ${fileName} to S3`);
		}
		console.log(`Successfully uploaded ${fileName} to S3`);
	}
};

export const getFileFromS3 = async (
	config: TranscriptionConfig,
	s3Key: string,
) => {
	const s3Client = getS3Client(config.aws.region);

	const file = await getFile(
		s3Client,
		config.app.sourceMediaBucket,
		s3Key,
		config.app.stage === 'DEV' ? `${__dirname}/sample` : '/tmp',
	);

	return file;
};
