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
import { AWSStatus } from './types';

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

type GetObjectTextSuccess = {
	status: AWSStatus.Success;
	text: string;
};

type GetObjectTextFailure = {
	status: AWSStatus.Failure;
	failureReason: 'NoSuchKey' | 'Unknown';
};

type GetObjectTextResult = GetObjectTextSuccess | GetObjectTextFailure;

export const isS3Failure = (
	result: GetObjectTextResult,
): result is GetObjectTextFailure => result.status === AWSStatus.Failure;

// for smaller files that will fit in memory - parse straight into a string
export const getObjectText = async (
	client: S3Client,
	bucket: string,
	key: string,
): Promise<GetObjectTextResult> => {
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
		return {
			status: AWSStatus.Success,
			text: Buffer.concat(chunks).toString('utf-8'),
		};
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.name === 'NoSuchKey') {
				return {
					status: AWSStatus.Failure,
					failureReason: 'NoSuchKey',
				};
			}
		}
		logger.error(`error getting object ${key} from bucket ${bucket}`, error);
		return {
			status: AWSStatus.Failure,
			failureReason: 'Unknown',
		};
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

export const downloadObject = async (
	client: S3Client,
	bucket: string,
	key: string,
	destinationPath: string,
) => {
	const data = await client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
		}),
	);
	if (!data.Body) {
		throw new Error(`Failed to retrieve object ${key} from bucket ${bucket}`);
	}
	await downloadS3Data(data.Body as Readable, destinationPath, key);
	return {
		destinationPath,
		extension: data.Metadata?.['extension'],
	};
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

export const mediaKey = (id: string) => `downloaded-media/${id}`;

export const getObjectSize = async (
	client: S3Client,
	bucket: string,
	key: string,
) => {
	const data = await client.send(
		new HeadObjectCommand({
			Bucket: bucket,
			Key: key,
		}),
	);
	return data.ContentLength;
};
