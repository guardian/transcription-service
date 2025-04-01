import {
	AutoScalingClient,
	DescribeAutoScalingGroupsCommand,
	SetDesiredCapacityCommand,
} from '@aws-sdk/client-auto-scaling';
import { logger } from '@guardian/transcription-service-backend-common';

export const setDesiredCapacity = async (
	asgClient: AutoScalingClient,
	asgGroupName: string,
	capacity: number,
) => {
	logger.info(
		`setting ASG desired capacity for ASG ${asgGroupName} to ${capacity}`,
	);

	try {
		const command = new SetDesiredCapacityCommand({
			AutoScalingGroupName: asgGroupName,
			DesiredCapacity: capacity,
		});
		await asgClient.send(command);
	} catch (error) {
		logger.error("Couldn't set desired capacity", error);
		throw error;
	}
};

export const getMaxCapacity = async (
	asgClient: AutoScalingClient,
	asgGroupName: string,
): Promise<number | undefined> => {
	try {
		const command = new DescribeAutoScalingGroupsCommand({
			AutoScalingGroupNames: [asgGroupName],
		});
		const asgDescriptions = await asgClient.send(command);
		const asgs = asgDescriptions.AutoScalingGroups;
		if (asgs !== undefined && asgs.length > 0) {
			return asgs[0]!.MaxSize;
		}
		return undefined;
	} catch (error) {
		logger.error("Couldn't get max capacity", error);
		throw error;
	}
};
