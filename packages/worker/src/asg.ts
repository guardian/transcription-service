import {
	AutoScalingClient,
	SetInstanceProtectionCommand,
} from '@aws-sdk/client-auto-scaling';
import { readFile } from './transcribe';

export const updateScaleInProtection = async (
	stage: string,
	value: boolean,
) => {
	try {
		const instanceId = readFile('/var/lib/cloud/data/instance-id');
		console.log(`instanceId: ${instanceId}`);
		const autoScalingClient = new AutoScalingClient();
		const input = {
			InstanceIds: [instanceId],
			AutoScalingGroupName: `transcription-service-workers-${stage}`,
			ProtectedFromScaleIn: value,
		};
		const command = new SetInstanceProtectionCommand(input);
		const response = await autoScalingClient.send(command);
		console.log('added scale-in protection', response);
	} catch (error) {
		console.log(`Could not remove scale-in protection`, error);
		throw error;
	}
};
