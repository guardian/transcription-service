import {
	GetObjectCommand,
	HeadObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedUrlSdk } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid4 } from 'uuid';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { z } from 'zod';

const ReadableBody = z.instanceof(Readable);

let s3Client: S3Client | undefined = undefined;
export const getS3Client = (region: string) => {
	if (s3Client) return s3Client;
	s3Client = new S3Client({
		region,
		useAccelerateEndpoint: true,
	});
	return s3Client;
};

export const getSignedUrl = (
	region: string,
	bucket: string,
	userEmail: string,
	fileName: string,
	expiresIn: number,
	id?: string,
) =>
	getSignedUrlSdk(
		getS3Client(region),
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

export const getDownloadSignedUrl = async (
	region: string,
	bucket: string,
	key: string,
	expiresIn: number,
) =>
	await getSignedUrlSdk(
		getS3Client(region),
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
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

export const getObjectMetadata = async (
	region: string,
	bucket: string,
	key: string,
) => {
	const client = getS3Client(region);
	const data = await client.send(
		new HeadObjectCommand({
			Bucket: bucket,
			Key: key,
		}),
	);
	return data.Metadata;
};
