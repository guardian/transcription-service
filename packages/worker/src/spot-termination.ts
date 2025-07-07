import {
	changeMessageVisibility,
	getIMDSToken,
	logger,
	METADATA_SERVICE_URL,
} from '@guardian/transcription-service-backend-common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { getCurrentReceiptHandle, setInterruptionTime } from './index';

const CHECK_FREQUENCY = 10;

export const checkSpotInterrupt = async (
	client: SQSClient,
	queueUrl: string,
) => {
	const imdsToken = await getIMDSToken();
	const url = `${METADATA_SERVICE_URL}/latest/meta-data/spot/instance-action`;
	try {
		const result = await fetch(url, {
			headers: {
				'X-aws-ec2-metadata-token': imdsToken,
			},
		});

		if (result.status === 200) {
			const json = await result.json();
			if (json.action === 'terminate') {
				const interruptionTime = new Date(json.time);
				setInterruptionTime(interruptionTime);
				logger.warn(
					`Spot instance scheduled for termination at ${interruptionTime.toISOString()}`,
				);
				// Interrupt warning occurs 2 minutes before termination
				const receiptHandle = getCurrentReceiptHandle();
				if (!receiptHandle) {
					return;
				}
				const secondsUntilTermination =
					(interruptionTime.getTime() - new Date().getTime()) / 1000;
				try {
					await changeMessageVisibility(
						client,
						queueUrl,
						receiptHandle,
						secondsUntilTermination,
					);
				} catch (e) {
					// we don't care if the visibility change fails - it will just delay the message being
					// picked up by a new worker, so do nothing here
				}
				// once the interrupt warning has happened, we don't need to keep checking
				return;
			}
		} else {
			logger.info(
				`Non-200 response from ${url}: ${result.status} ${result.statusText}`,
			);
		}
	} catch (e) {
		console.error('Error during spot termination check', e);
	}
	setTimeout(
		() => checkSpotInterrupt(client, queueUrl),
		1000 * CHECK_FREQUENCY,
	);
};
