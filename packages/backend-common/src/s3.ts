import {
	GetObjectCommand,
	HeadObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedUrlSdk } from '@aws-sdk/s3-request-presigner';
import { ReadStream, createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { z } from 'zod';
import axios from 'axios';
import { logger } from '@guardian/transcription-service-backend-common';

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

export const getSignedUploadUrl = (
	region: string,
	bucket: string,
	userEmail: string,
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
			},
		}),
		{ expiresIn }, // override default expiration time of 15 minutes
	);

export const getSignedDownloadUrl = async (
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

// for larger files (such as media files)- stream the file to disk
export const streamObjectToFile = async (
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
		logger.error(`failed to get S3 file ${key} in bucket ${bucket}`, e);
		throw e;
	}
};

// for smaller files that will fit in memory - parse straight into a string
export const getObjectText = async (
	client: S3Client,
	bucket: string,
	key: string,
) => {
	try {
		const data = await client.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: key,
			}),
		);
		const body = ReadableBody.parse(data.Body);
		const chunks: Uint8Array[] = [];
		for await (const chunk of body) {
			chunks.push(chunk);
		}
		return Buffer.concat(chunks).toString('utf-8');
	} catch (error) {
		console.error(`error getting object ${key} from bucket ${bucket}`, error);
		return undefined;
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
	const stream = data.pipe(createWriteStream(destinationPath));

	await new Promise<void>((resolve, reject) => {
		stream
			.on('finish', () => {
				logger.debug('stream pipe done');
				resolve();
			})
			.on('error', (error) => {
				logger.error(`Failed to write the S3 object ${key} into file`);
				reject(error);
			});
	});
	logger.info(`successfully retrieved file from S3 into ${destinationPath}`);
	return destinationPath;
};

export const getFileFromS3 = async (
	region: string,
	destinationDirectory: string,
	bucket: string,
	s3Key: string,
) => {
	const s3Client = getS3Client(region);

	const file = await streamObjectToFile(
		s3Client,
		bucket,
		s3Key,
		destinationDirectory,
	);

	return file;
};

export const getObjectMetadata = async (
	region: string,
	bucket: string,
	key: string,
) => {
	try {
		const client = getS3Client(region);
		const data = await client.send(
			new HeadObjectCommand({
				Bucket: bucket,
				Key: key,
			}),
		);
		return data.Metadata;
	} catch (e) {
		return;
	}
};
