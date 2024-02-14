import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedUrlSdk } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid4 } from 'uuid';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { z } from 'zod';

const ReadableBody = z.instanceof(Readable);

export const getS3Client = (region: string, useAccelerateEndpoint: boolean) => {
	return new S3Client({
		region,
		useAccelerateEndpoint,
	});
};

export const getSignedUrl = (
	region: string,
	bucket: string,
	userEmail: string,
	fileName: string,
	expiresIn: number,
	useAccelerateEndpoint: boolean,
	id?: string,
) =>
	getSignedUrlSdk(
		getS3Client(region, useAccelerateEndpoint),
		new PutObjectCommand({
			Bucket: bucket,
			Key: id || uuid4(),
			Metadata: {
				'user-email': userEmail,
				'file-name': fileName,
			},
		}),
		{ expiresIn }, // override default expiration time of 15 minutes
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

		const body = ReadableBody.parse(data.Body);

		const stream = body.pipe(createWriteStream(destinationPath));

		await new Promise<void>((resolve, reject) => {
			stream
				.on('finish', () => {
					console.log(` pipe done `);
					resolve();
				})
				.on('error', (error) => {
					console.log(`Failed to writing the S3 object ${key} into file`);
					reject(error);
				});
		});
		console.log('successfully retrieved file from S3 into ', destinationPath);
		return destinationPath;
	} catch (e) {
		console.error(e);
		throw e;
	}
};
