import { Handler } from 'aws-lambda';
import { sendEmail, getSESClient } from './ses';
import { IncomingSQSEvent } from './sqs-event-types';
import {
	TranscriptionConfig,
	getConfig,
	getFile,
	getS3Client,
} from '@guardian/transcription-service-backend-common';
import {
	getDynamoClient,
	TranscriptionItem,
	writeTranscriptionItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import type { Transcript } from '@guardian/transcription-service-backend-common/src/dynamodb';
import { testMessage } from '../test/testMessage';
import { type OutputBucketKeys } from '@guardian/transcription-service-common';

const messageBody = (
	transcriptId: string,
	transcript: string,
	originalFilename: string,
	rootUrl: string,
): string => {
	const exportUrl = `${rootUrl}/export/${transcriptId}`;
	return `
		<h1>Transcript for ${originalFilename} ready</h1>
		<p>Click <a href="${exportUrl}">here</a> to export to a google doc.</p>
		<h2>Transcript</h2>
		${transcript
			.split('\n')
			.map((line) => `<p>${line}</p>`)
			.join('')}
	`;
};

export const getFileFromS3 = async (
	config: TranscriptionConfig,
	s3Key: string,
) => {
	const s3Client = getS3Client(config.aws.region);

	const file = await getFile(
		s3Client,
		config.app.transcriptionOutputBucket,
		s3Key,
		config.app.stage === 'DEV' ? `${__dirname}/sample` : '/tmp',
	);

	return file;
};

export const getTranscriptsText = async (
	config: TranscriptionConfig,
	outputBucketKeys: OutputBucketKeys,
): Promise<Transcript> => {
	const srt = await getFileFromS3(config, outputBucketKeys.srt);
	const json = await getFileFromS3(config, outputBucketKeys.json);
	const text = await getFileFromS3(config, outputBucketKeys.text);

	const result: Transcript = { srt, json, text };

	return result;
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
			transcript: {
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
				transcripts.srt,
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
