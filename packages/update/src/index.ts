import { Handler } from 'aws-lambda';
import { getConfig } from '@guardian/transcription-service-common';
import { sendEmail, getSESClient } from './ses';
import { IncomingSQSEvent } from './sqs-event-types';

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
		<p>${transcript}</p>
	`;
};

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
			messageBody(
				transcriptionOutput.id,
				transcriptionOutput.transcriptionSrt,
				transcriptionOutput.originalFilename,
				config.app.rootUrl,
			),
		);
	}

	return 'Finished processing Event';
};

export { handler as update };
