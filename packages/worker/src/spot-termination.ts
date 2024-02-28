import { changeMessageVisibility } from '@guardian/transcription-service-backend-common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { setInterruptionTime } from './index';

const CHECK_FREQUENCY = 10;

export const checkSpotInterrupt = async (
	client: SQSClient,
	queueUrl: string,
	receiptHandle: string,
) => {
	console.log('Checking for spot interruption');
	const url = 'http://169.254.169.254/latest/meta-data/spot/instance-action';
	const result = await fetch(url);
	if (result.status === 200) {
		const json = await result.json();
		if (json.action === 'terminate') {
			setInterruptionTime(new Date(json.time));
			console.warn('Spot instance termination detected');
			// Interrupt warning occurs 2 minutes before termination
			await changeMessageVisibility(client, queueUrl, receiptHandle, 110);
		}
	}
	setTimeout(
		() => checkSpotInterrupt(client, queueUrl, receiptHandle),
		1000 * CHECK_FREQUENCY,
	);
};
