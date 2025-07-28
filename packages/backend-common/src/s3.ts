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
	id: string,
	fileName?: string,
) => {
	const metadata = {
		'user-email': userEmail,
	};
	const metadataWithFilename = fileName
		? {
				...metadata,
				originalFilename: fileName,
				extension: path.extname(fileName).replace('.', ''),
			}
		: metadata;
	return getSignedUrlSdk(
		getS3Client(region, useAccelerateEndpoint),
		new PutObjectCommand({
			Bucket: bucket,
			Key: id,
			Metadata: metadataWithFilename,
		}),
		{ expiresIn }, // override default expiration time of 15 minutes
	);
};

const sanitizeFilename = (filename: string) => {
	const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
	const extension = path.extname(sanitized);
	if (!extension) {
		// no extension - just return the filename truncated to 250 characters (max macos is 255, but the user may
		// manually add an extension so let's give them some headroom)
		return sanitized.substring(0, 250);
	}
	// file has an extension - truncate that to 20 chars and the filename to 220 chars. Note that extension will
	// include the leading . - so we start the substring from position 1
	const truncatedExtension = extension.substring(1, 21);
	const nameNoExtension = path.basename(sanitized, extension);
	const truncatedName = nameNoExtension.substring(0, 220);
	return `${truncatedName}.${truncatedExtension}`;
};

export const getSignedDownloadUrl = async (
	region: string,
	bucket: string,
	key: string,
	expiresIn: number,
	overrideFilename?: string,
) => {
	const responseContentDisposition = overrideFilename
		? `attachment; filename="${sanitizeFilename(overrideFilename)}"`
		: undefined;
	return await getSignedUrlSdk(
		getS3Client(region),
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
			ResponseContentDisposition: responseContentDisposition,
		}),
		{ expiresIn }, // override default expiration time of 15 minutes
	);
};

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
	logger.info(`Downloading ${key} from S3 to ${destinationPath}`);
	const data = await client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
		}),
	);
	if (!data.Body) {
		throw new Error(`Failed to retrieve object ${key} from bucket ${bucket}`);
	}
	// this is nasty but it works, and nobody here https://stackoverflow.com/questions/67366381/aws-s3-v3-javascript-sdk-stream-file-from-bucket-getobjectcommand
	// seems to be able to agree on a better approach
	const readableBody = data.Body as Readable;
	await downloadS3Data(readableBody, destinationPath, key, data.ContentLength);
	return data.Metadata?.['extension'];
};

const bytesToMB = (bytes: number) => Math.floor(bytes / 1024 / 1024);

const downloadS3Data = async (
	data: Readable,
	destinationPath: string,
	key: string,
	contentLength?: number,
) => {
	let downloadedBytes = 0;
	let lastLoggedPercentage = 0;
	const contentLengthMb = contentLength && bytesToMB(contentLength);
	data.on('data', (chunk) => {
		downloadedBytes += chunk.length;
		if (contentLength && contentLengthMb) {
			const percentage = Math.floor((downloadedBytes / contentLength) * 100);
			if (
				downloadedBytes > 0 &&
				contentLength > 0 &&
				percentage > lastLoggedPercentage
			) {
				lastLoggedPercentage = percentage;
				logger.info(
					`Downloaded ${bytesToMB(downloadedBytes)} of ${contentLengthMb} MB so far (${percentage}%) for ${key}`,
				);
			}
		}
	});
	const stream = createWriteStream(destinationPath);
	await new Promise<void>((resolve, reject) => {
		data
			.pipe(stream)
			.on('finish', () => {
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
