import {
	getConfig,
	getSQSClient,
	getNextMessage,
	parseTranscriptJobMessage,
	isFailure,
	deleteMessage,
	getFile,
	getS3Client,
} from '@guardian/transcription-service-backend-common';
import { getSNSClient, publishTranscriptionOutput } from './sns';
import { convertAndTranscribe } from './transcribe';

const main = async () => {
	const config = await getConfig();

	const s3Client = getS3Client(config.aws.region);
	const fileToTranscribe = await getFile(
		s3Client,
		`transcription-service-source-media-${config.app.stage.toLowerCase()}`,
		'tifsample.wav',
		config.app.stage === 'DEV' ? `${__dirname}/sample` : '/tmp',
	);

	await convertAndTranscribe(fileToTranscribe);

	const client = getSQSClient(config.aws.region, config.aws.localstackEndpoint);

	// to simulate a transcription job, delay 5 seconds in DEV, 2 minutes in PROD before deleting the message
	const dummyDelay = config.app.stage === 'DEV' ? 5 : 120;
	// override timeout to allow enough time for our dummy delay before message becomes available
	const timeoutOverride = dummyDelay + 1;
	const message = await getNextMessage(
		client,
		config.app.taskQueueUrl,
		timeoutOverride,
	);

	const snsClient = getSNSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);

	if (isFailure(message)) {
		return;
	}
	console.log(config.app.taskQueueUrl);

	await publishTranscriptionOutput(
		snsClient,
		config.app.destinationTopicArns.transcriptionService,
		{
			id: 'test-id',
			transcriptionSrt: 'test-srt',
			languageCode: 'en',
			userEmail: 'test@test.com',
		},
	);

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
		}, dummyDelay * 1000);
	}
};

main();
