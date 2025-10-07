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

type AsgCapacity = {
	max: number;
	desired: number;
};

export const getAsgCapacity = async (
	asgClient: AutoScalingClient,
	asgGroupName: string,
): Promise<AsgCapacity | undefined> => {
	try {
		const command = new DescribeAutoScalingGroupsCommand({
			AutoScalingGroupNames: [asgGroupName],
		});
		const asgDescriptions = await asgClient.send(command);
		const asgs = asgDescriptions.AutoScalingGroups;
		if (asgs !== undefined && asgs.length > 0) {
			const firstAsg = asgs[0];
			return firstAsg && firstAsg.MaxSize && firstAsg.DesiredCapacity
				? {
						max: firstAsg.MaxSize,
						desired: firstAsg.DesiredCapacity,
					}
				: undefined;
		}
		return undefined;
	} catch (error) {
		logger.error("Couldn't get max capacity", error);
		throw error;
	}
};
