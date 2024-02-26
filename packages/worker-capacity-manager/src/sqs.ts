import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';

export const getSQSQueueLengthIncludingInvisible = async (
	sqsClient: SQSClient,
	queueUrl: string,
): Promise<number> => {
	try {
		const command = new GetQueueAttributesCommand({
			QueueUrl: queueUrl,
			AttributeNames: [
				'ApproximateNumberOfMessages',
				'ApproximateNumberOfMessagesNotVisible',
			],
		});
		const response = await sqsClient.send(command);
		const attributes = response.Attributes;
		if (!attributes)
			throw new Error('unable to retrieve sqs message count attributes');
		return (
			Number(attributes.ApproximateNumberOfMessages) +
			Number(attributes.ApproximateNumberOfMessagesNotVisible)
		);
	} catch (error) {
		console.error("Couldn't get queue length", error);
		throw error;
	}
};
