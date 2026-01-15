import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '@guardian/transcription-service-backend-common';

export const getObjectLastModified = async (
	s3Client: S3Client,
	bucket: string,
	key: string,
): Promise<Date | undefined> => {
	try {
		const response = await s3Client.send(
			new HeadObjectCommand({
				Bucket: bucket,
				Key: key,
			}),
		);
		return response.LastModified;
	} catch (error) {
		logger.error(
			`Failed to get last modified date for s3://${bucket}/${key}`,
			error,
		);
		throw error;
	}
};

export const newArtifactAvailable = async (
	appStartTime: Date,
	s3Client: S3Client,
	bucket: string,
	key: string,
) => {
	const artifactLastModified = await getObjectLastModified(
		s3Client,
		bucket,
		key,
	);

	return (
		artifactLastModified &&
		appStartTime.getTime() < artifactLastModified.getTime()
	);
};
