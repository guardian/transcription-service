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
	const client = getClient(config.aws.region, config.aws.localstackEndpoint);

	// to simulate a transcription job, delay 5 seconds in DEV, 2 minutes in PROD before deleting the message
	const dummyDelay = config.app.stage === 'DEV' ? 5000 : 120000;
	// override timeout to allow enough time for our dummy delay before message becomes available
	const timeoutOverride = dummyDelay + 1000;
	const message = await getNextMessage(
		client,
		config.app.taskQueueUrl,
		timeoutOverride,
	);
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
		setTimeout(() => {
			console.log(`Deleting message ${message.message?.MessageId}`);
			deleteMessage(
				client,
				config.app.taskQueueUrl,
				message.message?.ReceiptHandle as string,
			);
		}, dummyDelay);
	}
};

main();
