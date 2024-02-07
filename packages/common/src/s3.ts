import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';

export const getS3Client = (region: string) => {
	return new S3Client({
		region,
	});
};

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

		const stream = (data.Body as Readable).pipe(
			createWriteStream(destinationPath),
		);

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
