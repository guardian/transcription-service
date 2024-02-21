import { SetInstanceProtectionCommand } from '@aws-sdk/client-auto-scaling';
import { readFile } from '@guardian/transcription-service-backend-common';
import { getASGClient } from '@guardian/transcription-service-backend-common/src/asg';

export const updateScaleInProtection = async (
	region: string,
	stage: string,
	value: boolean,
) => {
	try {
		if (stage !== 'DEV') {
			const instanceId = readFile('/var/lib/cloud/data/instance-id');
			console.log(`instanceId: ${instanceId}`);
			const autoScalingClient = getASGClient(region);
			const input = {
				InstanceIds: [instanceId.trim()],
				AutoScalingGroupName: `transcription-service-workers-${stage}`,
				ProtectedFromScaleIn: value,
			};
			const command = new SetInstanceProtectionCommand(input);
			await autoScalingClient.send(command);
			console.log(
				`Updated scale-in protection to value ${value} for instance ${instanceId}`,
			);
		}
	} catch (error) {
		console.log(`Could not remove scale-in protection`, error);
		throw error;
	}
};
