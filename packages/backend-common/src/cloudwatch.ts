import {
	CloudWatchClient,
	PutMetricDataCommand,
	PutMetricDataInput,
} from '@aws-sdk/client-cloudwatch';
import { logger } from './logging';

export const getCloudwatchClient = (region: string) => {
	return new CloudWatchClient({ region });
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
