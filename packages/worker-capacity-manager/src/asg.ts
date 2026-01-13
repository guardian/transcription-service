import {
	AutoScalingClient,
	DescribeAutoScalingGroupsCommand,
	SetDesiredCapacityCommand,
	StartInstanceRefreshCommand,
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

export const refreshASG = async (
	asgClient: AutoScalingClient,
	asgName: string,
) => {
	logger.info(`Starting instance refresh for ASG ${asgName}`);

	try {
		const command = new StartInstanceRefreshCommand({
			AutoScalingGroupName: asgName,
			Strategy: 'Rolling',
			Preferences: {
				MinHealthyPercentage: 0,
				// allow transcription jobs to finish before refresh
				ScaleInProtectedInstances: 'Wait',
			},
		});
		const response = await asgClient.send(command);
		logger.info(
			`Instance refresh started for ASG ${asgName}, refresh ID: ${response.InstanceRefreshId}`,
		);
		return response.InstanceRefreshId;
	} catch (error) {
		logger.error(`Couldn't start instance refresh for ASG ${asgName}`, error);
		throw error;
	}
};
