import {
	CloudWatchClient,
	PutMetricDataCommand,
	PutMetricDataInput,
} from '@aws-sdk/client-cloudwatch';
import { logger } from './logging';
import { AwsConfig } from './types';

export const getCloudwatchClient = (awsConfig: AwsConfig) => {
	return new CloudWatchClient(awsConfig);
};

export const putMetricData = async (
	client: CloudWatchClient,
	metricData: PutMetricDataInput,
) => {
	try {
		await client.send(new PutMetricDataCommand(metricData));
	} catch (error) {
		logger.error('Error writing to cloudwatch', error);
		throw error;
	}
};
