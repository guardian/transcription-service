import {
	AutoScalingClient,
	DescribeAutoScalingInstancesCommand,
	SetInstanceProtectionCommand,
} from '@aws-sdk/client-auto-scaling';
import { logger } from '@guardian/transcription-service-backend-common';

export const updateScaleInProtection = async (
	autoScalingClient: AutoScalingClient,
	stage: string,
	value: boolean,
	instanceId: string,
) => {
	try {
		if (stage !== 'DEV') {
			logger.info(`instanceId retrieved from worker instance: ${instanceId}`);

			const input = {
				InstanceIds: [instanceId.trim()],
				AutoScalingGroupName: `transcription-service-workers-${stage}`,
				ProtectedFromScaleIn: value,
			};
			const command = new SetInstanceProtectionCommand(input);
			await autoScalingClient.send(command);
			logger.info(
				`Updated scale-in protection to value ${value} for instance ${instanceId}`,
			);
		}
	} catch (error) {
		logger.error(`Could not set scale-in protection`, error);
		throw error;
	}
};

export const getInstanceLifecycleState = async (
	autoScalingClient: AutoScalingClient,
	stage: string,
	instanceId: string,
) => {
	try {
		if (stage !== 'DEV') {
			const input = {
				InstanceIds: [instanceId.trim()],
			};
			const command = new DescribeAutoScalingInstancesCommand(input);
			const result = await autoScalingClient.send(command);
			const lifecycleState = result.AutoScalingInstances?.find(
				(i) => i.InstanceId === instanceId,
			)?.LifecycleState;
			if (lifecycleState === undefined)
				throw new Error('Could not find instance lifecycle state!');

			logger.info(`lifecycleState ${lifecycleState}`);
			return lifecycleState;
		} else {
			return undefined;
		}
	} catch (error) {
		logger.error(`Could not retrieve ASG instance lifecycle state`, error);
		throw error;
	}
};
