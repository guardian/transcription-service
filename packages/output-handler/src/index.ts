import { Handler } from 'aws-lambda';
import { sendEmail, getSESClient } from './ses';
import { IncomingSQSEvent } from './sqs-event-types';
import {
	TranscriptionConfig,
	getConfig,
	getFileFromS3,
	readFile,
} from '@guardian/transcription-service-backend-common';
import {
	getDynamoClient,
	TranscriptionItem,
	writeTranscriptionItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import type { Transcripts } from '@guardian/transcription-service-backend-common/src/dynamodb';
import { testMessage } from '../test/testMessage';
import { type OutputBucketKeys } from '@guardian/transcription-service-common';

const messageBody = (
	transcriptId: string,
	originalFilename: string,
	rootUrl: string,
): string => {
	const exportUrl = `${rootUrl}/export?transcriptId=${transcriptId}`;
	return `
		<h1>Transcript for ${originalFilename} ready</h1>
		<p>Click <a href="${exportUrl}">here</a> to export to a google doc.</p>
	`;
};

export const getTranscriptsText = async (
	config: TranscriptionConfig,
	outputBucketKeys: OutputBucketKeys,
): Promise<Transcripts> => {
	try {
		const destinationDirectory =
			config.app.stage === 'DEV' ? `${__dirname}/sample` : '/tmp';
		const srtFile = await getFileFromS3(
			config.aws.region,
			destinationDirectory,
			config.app.transcriptionOutputBucket,
			outputBucketKeys.srt,
		);
		const jsonFile = await getFileFromS3(
			config.aws.region,
			destinationDirectory,
			config.app.transcriptionOutputBucket,
			outputBucketKeys.json,
		);
		const textFile = await getFileFromS3(
			config.aws.region,
			destinationDirectory,
			config.app.transcriptionOutputBucket,
			outputBucketKeys.text,
		);

		const srt = readFile(srtFile);
		const json = readFile(jsonFile);
		const text = readFile(textFile);

		const result: Transcripts = { srt, json, text };

		return result;
	} catch (error) {
		console.log(`failed to get transcription texts from S3`, error);
		throw error;
	}
};

const processMessage = async (event: unknown) => {
	const config = await getConfig();
	const sesClient = getSESClient(config.aws.region);

	const parsedEvent = IncomingSQSEvent.safeParse(event);
	if (!parsedEvent.success) {
		console.error('Failed to parse SQS message', parsedEvent.error.message);
		throw new Error('Failed to parse SQS message');
	}

	for (const record of parsedEvent.data.Records) {
		const transcriptionOutput = record.body.Message;

		const transcripts = await getTranscriptsText(
			config,
			transcriptionOutput.outputBucketKeys,
		);

		const dynamoItem: TranscriptionItem = {
			id: transcriptionOutput.id,
			originalFilename: transcriptionOutput.originalFilename,
			transcripts: {
				srt: transcripts.srt,
				text: transcripts.text,
				json: transcripts.json,
			},
			userEmail: transcriptionOutput.userEmail,
		};

		await writeTranscriptionItem(
			getDynamoClient(config.aws.region, config.aws.localstackEndpoint),
			config.app.tableName,
			dynamoItem,
		);

		await sendEmail(
			sesClient,
			config.app.emailNotificationFromAddress,
			transcriptionOutput.userEmail,
			transcriptionOutput.originalFilename,
			messageBody(
				transcriptionOutput.id,
				transcriptionOutput.originalFilename,
				config.app.rootUrl,
			),
		);
	}
};

const handler: Handler = async (event) => {
	await processMessage(event);
	return 'Finished processing Event';
};

// when running locally bypass the handler
if (!process.env['AWS_EXECUTION_ENV']) {
	processMessage(testMessage);
}
export { handler as outputHandler };
