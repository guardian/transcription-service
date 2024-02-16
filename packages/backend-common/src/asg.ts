import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';

export const getASGClient = (region: string) => {
	return new AutoScalingClient({ region });
};
