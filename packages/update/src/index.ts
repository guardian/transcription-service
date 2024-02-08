import { Handler } from 'aws-lambda';
import {
	getConfig,
	TranscriptionOutput,
} from '@guardian/transcription-service-common';
import { sendEmail, getSESClient } from './ses';
import { z } from 'zod';

export const IncomingSQSEvent = z.object({
	Records: z.array(
		z.object({
			body: z.string(),
		}),
	),
});

export const SQSMessageBody = z.object({
	MessageId: z.string(),
	Timestamp: z.string(),
	Message: z.string(),
});

export type SQSMessageBody = z.infer<typeof SQSMessageBody>;

export type IncomingSQSEvent = z.infer<typeof IncomingSQSEvent>;

const handler: Handler = async (event, context) => {
	console.log('EVENT: \n' + JSON.stringify(event, null, 2));

	const sqsMessage = IncomingSQSEvent.safeParse(event);
	if (!sqsMessage.success || !sqsMessage.data.Records[0]) {
		throw new Error('Failed to parse SQS message');
	}

	const messageBody = SQSMessageBody.safeParse(
		JSON.parse(sqsMessage.data.Records[0].body),
	);

	if (!messageBody.success) {
		throw new Error('Failed to parse SQS message body');
	}

	const transcriptionOutput = TranscriptionOutput.safeParse(
		JSON.parse(messageBody.data.Message),
	);

	if (!transcriptionOutput.success) {
		console.log(sqsMessage.data);
		console.log(sqsMessage.data.Records[0]);
		console.log(JSON.parse(sqsMessage.data.Records[0].body));
		throw new Error('Failed to parse transcription output from SQS message');
	}

	const config = await getConfig();
	const sesClient = getSESClient(config.aws.region);
	await sendEmail(
		sesClient,
		config.app.emailNotificationFromAddress,
		transcriptionOutput.data.userEmail,
		transcriptionOutput.data.originalFilename,
	);
	return context.logStreamName;
};

export { handler as update };
