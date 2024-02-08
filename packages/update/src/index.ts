import { Handler } from 'aws-lambda';
import {
	getConfig,
	TranscriptionOutput,
} from '@guardian/transcription-service-common';
import { sendEmail, getSESClient } from './ses';
import { z } from 'zod';
import { stringToJSONSchema } from './json';

export const SQSMessageBody = z.object({
	MessageId: z.string(),
	Timestamp: z.string(),
	Message: stringToJSONSchema.pipe(TranscriptionOutput),
});

export const IncomingSQSEvent = z.object({
	Records: z.array(
		z.object({
			body: stringToJSONSchema.pipe(SQSMessageBody),
		}),
	),
});

export type SQSMessageBody = z.infer<typeof SQSMessageBody>;

export type IncomingSQSEvent = z.infer<typeof IncomingSQSEvent>;

const handler: Handler = async (event) => {
	const config = await getConfig();
	const sesClient = getSESClient(config.aws.region);

	const parsedEvent = IncomingSQSEvent.safeParse(event);
	if (!parsedEvent.success) {
		console.error('Failed to parse SQS message', parsedEvent.error.message);
		throw new Error('Failed to parse SQS message');
	}

	for (const record of parsedEvent.data.Records) {
		const transcriptionOutput = record.body.Message;
		await sendEmail(
			sesClient,
			config.app.emailNotificationFromAddress,
			transcriptionOutput.userEmail,
			transcriptionOutput.originalFilename,
		);
	}

	return 'Finished processing Event';
};

export { handler as update };
