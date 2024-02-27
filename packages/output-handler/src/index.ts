import { Handler } from 'aws-lambda';
import { sendEmail, getSESClient } from './ses';
import { IncomingSQSEvent } from './sqs-event-types';
<<<<<<< HEAD
import {
	logger,
	TranscriptionConfig,
	getConfig,
	getFileFromS3,
	readFile,
} from '@guardian/transcription-service-backend-common';
=======
import { getConfig } from '@guardian/transcription-service-backend-common';
>>>>>>> d5d3a65 (Store transcripts in s3 to work round dynamo 400kb limit)
import {
	getDynamoClient,
	TranscriptionDynamoItem,
	writeTranscriptionItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import { testMessage } from '../test/testMessage';
import {
	MetricsService,
	FailureMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';

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

const processMessage = async (event: unknown) => {
	const config = await getConfig();
	const sesClient = getSESClient(config.aws.region);

	const metrics = new MetricsService(
		config.app.stage,
		config.aws.region,
		'output-handler',
	);

	const parsedEvent = IncomingSQSEvent.safeParse(event);
	if (!parsedEvent.success) {
		logger.error(`Failed to parse SQS message ${parsedEvent.error.message}`);
		throw new Error('Failed to parse SQS message');
	}

	for (const record of parsedEvent.data.Records) {
		const transcriptionOutput = record.body.Message;

		const dynamoItem: TranscriptionDynamoItem = {
			id: transcriptionOutput.id,
			originalFilename: transcriptionOutput.originalFilename,
			transcriptKeys: {
				srt: transcriptionOutput.outputBucketKeys.srt,
				text: transcriptionOutput.outputBucketKeys.text,
				json: transcriptionOutput.outputBucketKeys.json,
			},
			userEmail: transcriptionOutput.userEmail,
		};

		try {
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

			logger.info('Output handler successfully sent email notification', {
				id: transcriptionOutput.id,
				filename: transcriptionOutput.originalFilename,
				userEmail: transcriptionOutput.userEmail,
			});
		} catch (error) {
			logger.error(
				'Failed to process sqs message - transcription data may be missing from dynamo or email failed to send',
				error,
			);
			await metrics.putMetric(FailureMetric);
		}
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
