import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DescribeInstancesCommand, EC2Client } from '@aws-sdk/client-ec2';
import { logger } from '@guardian/transcription-service-backend-common';

export const getArtifactLastModified = async (
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

export const getInstanceStartTime = async (
	ec2Client: EC2Client,
	instanceId: string,
): Promise<Date> => {
	try {
		const command = new DescribeInstancesCommand({
			InstanceIds: [instanceId],
		});
		const response = await ec2Client.send(command);

		const instance = response.Reservations?.[0]?.Instances?.[0];

		if (instance?.LaunchTime) {
			return instance.LaunchTime;
		}
	} catch (error) {
		logger.error(`Failed to get start time for instance ${instanceId}`, error);
		throw error;
	}
	throw new Error(`Can't get instance start time -  ${instanceId} not found`);
};

export const newArtifactAvailable = async (
	instanceStartTime: Date,
	s3Client: S3Client,
	bucket: string,
	key: string,
) => {
	const artifactLastModified = await getArtifactLastModified(
		s3Client,
		bucket,
		key,
	);

	return (
		artifactLastModified &&
		instanceStartTime &&
		instanceStartTime.getTime() < artifactLastModified.getTime()
	);
};
