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

export type IncomingSQSEvent = z.infer<typeof IncomingSQSEvent>;

const handler: Handler = async (event, context) => {
	console.log('EVENT: \n' + JSON.stringify(event, null, 2));

	const sqsMessage = IncomingSQSEvent.safeParse(event);
	if (!sqsMessage.success || !sqsMessage.data.Records[0]) {
		throw new Error('Failed to parse SQS message');
	}

	const transcriptionOutput = TranscriptionOutput.safeParse(
		JSON.parse(sqsMessage.data.Records[0].body),
	);
	if (!transcriptionOutput.success) {
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
