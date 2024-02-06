import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedUrlSdk } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid4 } from 'uuid';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';

export const getS3Client = (region: string) => {
	return new S3Client({
		region,
		useAccelerateEndpoint: true,
	});
};

export const getSignedUrl = (
	region: string,
	bucket: string,
	userEmail: string,
	fileName: string,
) =>
	getSignedUrlSdk(
		getS3Client(region),
		new PutObjectCommand({
			Bucket: bucket,
			Key: uuid4(),
			Metadata: {
				'user-email': userEmail,
				'file-name': fileName,
			},
		}),
		{ expiresIn: 60 }, // override default expiration time of 15 minutes
	);

export const getFile = async (
	client: S3Client,
	bucket: string,
	key: string,
	workingDirectory: string,
) => {
	try {
		const destinationPath = `${workingDirectory}/${path.basename(key)}`;
		const data = await client.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: key,
			}),
		);
		(data.Body as Readable).pipe(createWriteStream(destinationPath));
		console.log('successfully retrieved file from S3 into ', destinationPath);
		return destinationPath;
	} catch (e) {
		console.error(e);
		throw e;
	}
};
