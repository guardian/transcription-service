import {
	getConfig,
	getClient,
	getNextMessage,
	parseTranscriptJobMessage,
	isFailure,
	deleteMessage,
} from '@guardian/transcription-service-common';

const main = async () => {
	const config = await getConfig();
	const localstackEndpoint =
		config.stage === 'DEV' ? new URL(config.taskQueueUrl).origin : undefined;
	const client = getClient(localstackEndpoint);
	const message = await getNextMessage(client, config.taskQueueUrl);
	if (isFailure(message)) {
		return;
	}

	if (message.message?.ReceiptHandle) {
		const job = parseTranscriptJobMessage(message.message);
		console.log(
			`Fetched transcription job with id ${message.message.MessageId}}`,
			job,
		);
		// wait for 3 minutes then delete the message to simulate the transcription
		setTimeout(
			() => {
				console.log(`Deleting message ${message.message.MessageId}`);
				deleteMessage(
					client,
					config.taskQueueUrl,
					message.message?.ReceiptHandle as string,
				);
			},
			config.stage === 'DEV' ? 10000 : 180000,
		);
	}
};

main();
