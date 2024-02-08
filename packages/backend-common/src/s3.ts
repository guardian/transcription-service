import { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedUrlSdk } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid4 } from 'uuid';

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
