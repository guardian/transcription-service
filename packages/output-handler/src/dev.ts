import {
	deleteMessage,
	getConfig,
	getNextMessage,
	getSQSClient,
	isSqsFailure,
	logger,
} from '@guardian/transcription-service-backend-common';
import { processMessage } from './index';

export const devTrigger = () => {
	const OUTPUT_QUEUE_URL =
		'http://localhost:4566/000000000000/transcription-service-output-queue-DEV';

	const fetchAndProcessMessage = async () => {
		const config = await getConfig();
		const sqsClient = getSQSClient(config.aws, config.dev?.localstackEndpoint);

		logger.info(`Polling for message from ${OUTPUT_QUEUE_URL}`);
		const receiveResult = await getNextMessage(sqsClient, OUTPUT_QUEUE_URL);

		if (isSqsFailure(receiveResult)) {
			logger.error('Failed to receive message from localstack queue');
			return;
		}

		const message = receiveResult.message;
		if (!message || !message.Body) {
			logger.info('No messages in the queue');
			return;
		}

		logger.info(`Received message: ${message.MessageId}`);

		if (message.ReceiptHandle) {
			await deleteMessage(
				sqsClient,
				OUTPUT_QUEUE_URL,
				message.ReceiptHandle,
				message.MessageId ?? 'unknown',
			);
			logger.info('Deleted message from queue');
		}

		const event = {
			Records: [
				{
					messageId: message.MessageId ?? 'local',
					body: message.Body,
				},
			],
		};

		await processMessage(event);
	};

	const poll = () => {
		fetchAndProcessMessage()
			.catch((err) => {
				logger.error(
					'Failed to fetch and process message from localstack',
					err,
				);
			})
			.finally(() => {
				setTimeout(poll, 2000);
			});
	};
	poll();
};
