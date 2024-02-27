import { SetInstanceProtectionCommand } from '@aws-sdk/client-auto-scaling';
import {
	readFile,
	getASGClient,
} from '@guardian/transcription-service-backend-common';
import { logger } from '@guardian/transcription-service-backend-common/src/logging';

export const updateScaleInProtection = async (
	region: string,
	stage: string,
	value: boolean,
) => {
	try {
		if (stage !== 'DEV') {
			const instanceId = readFile('/var/lib/cloud/data/instance-id');
			logger.info(`instanceId: ${instanceId}`);
			const autoScalingClient = getASGClient(region);
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
