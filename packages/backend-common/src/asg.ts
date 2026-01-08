import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';
import { AwsConfig } from './types';

export const getASGClient = (awsConfig: AwsConfig) => {
	return new AutoScalingClient(awsConfig);
};
