import {
	AutoScalingClient,
	DescribeAutoScalingInstancesCommand,
	SetInstanceProtectionCommand,
	TerminateInstanceInAutoScalingGroupCommand,
} from '@aws-sdk/client-auto-scaling';
import { logger } from '@guardian/transcription-service-backend-common';

export const updateScaleInProtection = async (
	autoScalingClient: AutoScalingClient,
	stage: string,
	value: boolean,
	instanceId: string,
	asgName: string,
) => {
	try {
		if (stage !== 'DEV') {
			logger.info(`instanceId retrieved from worker instance: ${instanceId}`);

			const input = {
				InstanceIds: [instanceId],
				AutoScalingGroupName: asgName,
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
				InstanceIds: [instanceId],
			};
			const command = new DescribeAutoScalingInstancesCommand(input);
			const result = await autoScalingClient.send(command);
			const lifecycleState = result.AutoScalingInstances?.find(
				(i) => i.InstanceId === instanceId,
			)?.LifecycleState;
			if (lifecycleState === undefined) {
				throw new Error('Could not find instance lifecycle state!');
			}

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

export const terminateInstance = async (
	autoscalingClient: AutoScalingClient,
	instanceId: string,
) => {
	try {
		logger.info(`Terminating instance ${instanceId} in ASG`);
		const input = {
			InstanceId: instanceId,
			ShouldDecrementDesiredCapacity: false,
		};
		const command = new TerminateInstanceInAutoScalingGroupCommand(input);
		const result = await autoscalingClient.send(command);
		logger.info(
			`Successfully initiated termination of instance ${instanceId}. Activity ID: ${result.Activity?.ActivityId}`,
		);
		return result;
	} catch (error) {
		logger.error(`Could not terminate instance ${instanceId} in ASG`, error);
		throw error;
	}
};
