import { Message, SQSClient } from '@aws-sdk/client-sqs';
import { MediaDownloadJob } from '@guardian/transcription-service-common';
import {
	getNextMessage,
	isSqsFailure,
	logger,
} from '@guardian/transcription-service-backend-common';

const parseMediaJobMessage = (
	message: Message,
): MediaDownloadJob | undefined => {
	if (!message.Body) {
		return undefined;
	}
	const job = MediaDownloadJob.safeParse(JSON.parse(message.Body));
	if (job.success) {
		return job.data;
	}
	logger.error(
		`Failed to parse message ${message.MessageId}, contents: ${message.Body}`,
	);
	return undefined;
};

export const getNextJob = async (
	client: SQSClient,
	queueUrl: string,
	isDev: boolean,
) => {
	const message = await getNextMessage(client, queueUrl);

	if (isSqsFailure(message)) {
		logger.error(`Failed to fetch message due to ${message.errorMsg}`);
		return;
	}

	if (!message.message) {
		logger.info('No messages available');
		return;
	}

	const taskMessage = message.message;
	if (!taskMessage.Body) {
		logger.error('message missing body');
		return;
	}
	if (!taskMessage.Attributes && !isDev) {
		logger.error('message missing attributes');
		return;
	}
	return parseMediaJobMessage(taskMessage);
};
