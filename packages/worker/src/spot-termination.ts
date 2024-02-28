import { changeMessageVisibility } from '@guardian/transcription-service-backend-common';

export const checkSpotInterrupt = async () => {
	console.log('Checking for spot interruption');
	const url = 'http://169.254.169.254/latest/meta-data/spot/instance-action';
	const result = await fetch(url);
	if (result.status === 200) {
		const json = await result.json();
		if (json.action === 'terminate') {
			console.log('Spot instance termination detected');
			await changeMessageVisibility(
				sqsClient,
				config.app.taskQueueUrl,
				receiptHandle,
				0,
			);
			return;
		}
	}
	setTimeout(checkSpotInterrupt, 1000 * 10);
};
