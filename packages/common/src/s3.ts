import { S3Client } from '@aws-sdk/client-s3';

export const getClient = (region: string) => {
	return new S3Client({
		region,
	});
};
