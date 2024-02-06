import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
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

const publishMessage = async (
	client: SNSClient,
	topicArn: string,
	message: string,
): Promise<string | undefined> => {
	try {
		const resp = await client.send(
			new PublishCommand({ TopicArn: topicArn, Message: message }),
		);
		console.log('message sent', resp);
		return resp.MessageId;
	} catch (e) {
		console.error('Error publishing message', e);
		throw e;
	}
};

export const publishTranscriptionOutput = async (
	client: SNSClient,
	topicArn: string,
	output: TranscriptionOutput,
) => {
	await publishMessage(client, topicArn, JSON.stringify(output));
};
