import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedUrlSdk } from '@aws-sdk/s3-request-presigner';
import { ReadStream, createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { z } from 'zod';
import axios from 'axios';

const ReadableBody = z.instanceof(Readable);

export const getS3Client = (
	region: string,
	useAccelerateEndpoint: boolean = false,
) => {
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
			Key: id,
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
		await downloadS3Data(body, destinationPath, key);
		return destinationPath;
	} catch (e) {
		console.error(e);
		throw e;
	}
};

export const getObjectWithPresignedUrl = async (
	presignedUrl: string,
	key: string,
	workingDirectory: string,
) => {
	const destinationPath = `${workingDirectory}/${path.basename(key)}`;
	const response = await axios.get<ReadStream>(presignedUrl, {
		responseType: 'stream',
	});
	const body = ReadableBody.parse(response.data);
	await downloadS3Data(body, destinationPath, key);
	return destinationPath;
};

const downloadS3Data = async (
	data: Readable,
	destinationPath: string,
	key: string,
) => {
	const body = ReadableBody.parse(data);

	const stream = body.pipe(createWriteStream(destinationPath));

	await new Promise<void>((resolve, reject) => {
		stream
			.on('finish', () => {
				console.log(` pipe done `);
				resolve();
			})
			.on('error', (error) => {
				console.log(`Failed to write the S3 object ${key} into file`);
				reject(error);
			});
	});
	console.log('successfully retrieved file from S3 into ', destinationPath);
	return destinationPath;
};

export const getFileFromS3 = async (
	region: string,
	destinationDirectory: string,
	bucket: string,
	s3Key: string,
) => {
	const s3Client = getS3Client(region);

	const file = await getFile(s3Client, bucket, s3Key, destinationDirectory);

	return file;
};
