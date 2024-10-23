import {
	getConfig,
	getSQSClient,
} from '@guardian/transcription-service-backend-common';
import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { getNextJob } from './sqs';
import { downloadMedia, MediaMetadata } from './yt-dlp';

const uploadToS3 = async (
	s3Client: S3Client,
	metadata: MediaMetadata,
	bucket: string,
) => {
	const fileStream = createReadStream(`${metadata.mediaPath}`);
	try {
		const upload = new Upload({
			client: s3Client,
			params: {
				Bucket: bucket,
				Key: `downloaded-media/${metadata.title}.${metadata.extension}`,
				Body: fileStream,
			},
		});

		await upload.done();
	} catch (e) {
		console.error(e);
	}
};

const main = async () => {
	const config = await getConfig();

	const s3Client = new S3Client({ region: config.aws.region });
	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);
	const job = await getNextJob(
		sqsClient,
		config.app.mediaDownloadQueueUrl,
		config.app.stage === 'DEV',
	);
	if (job) {
		const metadata = await downloadMedia(job.url, '/tmp', job.id);
		await uploadToS3(s3Client, metadata, config.app.sourceMediaBucket);
	}
};

main();
