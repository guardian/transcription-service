import {
	AutoScalingClient,
	SetInstanceProtectionCommand,
} from '@aws-sdk/client-auto-scaling';
import { readFile } from '@guardian/transcription-service-backend-common';

export const updateScaleInProtection = async (
	region: string,
	stage: string,
	value: boolean,
) => {
	const clientConfig = {
		region,
	};
	try {
		if (stage !== 'DEV') {
			const instanceId = readFile('/var/lib/cloud/data/instance-id');
			console.log(`instanceId: ${instanceId}`);
			const autoScalingClient = new AutoScalingClient(clientConfig);
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
