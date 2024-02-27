import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { logger } from '@guardian/transcription-service-backend-common/src/logging';
import { TranscriptionOutput } from '@guardian/transcription-service-common';

export const getSNSClient = (region: string, localstackEndpoint?: string) => {
	const clientBaseConfig = {
		region,
	};
	const clientConfig = localstackEndpoint
		? { ...clientBaseConfig, endpoint: localstackEndpoint }
		: clientBaseConfig;

	return new SNSClient(clientConfig);
};

export const publishMessage = async (
	client: SNSClient,
	topicArn: string,
	output: TranscriptionOutput,
): Promise<string | undefined> => {
	try {
		const resp = await client.send(
			new PublishCommand({
				TopicArn: topicArn,
				Message: JSON.stringify(output),
			}),
		);
		logger.info('message sent', output);
		return resp.MessageId;
	} catch (e) {
		logger.error('Error publishing message', e);
		throw e;
	}
};

// export const publishTranscriptionOutput = async (
// 	client: SNSClient,
// 	topicArn: string,
// 	output: TranscriptionOutput,
// ) => {
// 	await publishMessage(client, topicArn, JSON.stringify(output));
// };
