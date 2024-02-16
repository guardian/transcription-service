import {
	AutoScalingClient,
	SetDesiredCapacityCommand,
} from '@aws-sdk/client-auto-scaling';

export const setDesiredCapacity = async (
	asgClient: AutoScalingClient,
	asgGroupName: string,
	capacity: number,
) => {
	try {
		const command = new SetDesiredCapacityCommand({
			AutoScalingGroupName: asgGroupName,
			DesiredCapacity: capacity,
		});
		await asgClient.send(command);
	} catch (error) {
		console.log("Couldn't set desired capacity", error);
		throw error;
	}
};
