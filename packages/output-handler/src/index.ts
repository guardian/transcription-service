import { Handler } from 'aws-lambda';
import { sendEmail, getSESClient } from './ses';
import { IncomingSQSEvent } from './sqs-event-types';
import {
	logger,
	getConfig,
	TranscriptionConfig,
	getSignedDownloadUrl,
} from '@guardian/transcription-service-backend-common';
import {
	getDynamoClient,
	TranscriptionDynamoItem,
	writeTranscriptionItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import { testMessage } from '../test/testMessage';
import {
	transcriptionOutputIsSuccess,
	TranscriptionOutputSuccess,
	TranscriptionOutputFailure,
	transcriptionOutputIsTranscriptionFailure,
} from '@guardian/transcription-service-common';
import {
	MetricsService,
	FailureMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { SESClient } from '@aws-sdk/client-ses';

const successMessageBody = (
	transcriptId: string,
	originalFilename: string,
	rootUrl: string,
	isTranslation: boolean,
	sourceMediaDownloadUrl: string,
): string => {
	const exportUrl = `${rootUrl}/export?transcriptId=${transcriptId}`;
	return `
		<h1>${isTranslation ? 'English translation ' : 'Transcription'} for ${originalFilename} ready</h1>
		<p>Click <a href="${exportUrl}">here</a> to export to a Google doc.</p>
		<p>Click <a href="${sourceMediaDownloadUrl}">here</a> to download the input media.</p>
		<p><b>Note:</b> transcripts will be deleted from this service after 7 days. Export your transcript to a Google doc now if you want to keep it. </p>
	`;
};

const failureMessageBody = (
	originalFilename: string,
	id: string,
	isTranslation: boolean,
	sourceMediaDownloadUrl: string,
): string => {
	return `
		<h1>${isTranslation ? 'English translation ' : 'Transcription'}for ${originalFilename} has failed.</h1>
		<p>Please make sure that the file is a valid audio or video file.</p>
		<p>Click <a href="${sourceMediaDownloadUrl}">here</a> to download the input media.</p>
		<p>Contact digital.investigations@guardian.co.uk for support.</p>
		<p>Transcription ID: ${id}</p>
	`;
};

const handleTranscriptionSuccess = async (
	config: TranscriptionConfig,
	transcriptionOutput: TranscriptionOutputSuccess,
	sesClient: SESClient,
	metrics: MetricsService,
	sourceMediaDownloadUrl: string,
) => {
	const dynamoItem: TranscriptionDynamoItem = {
		id: transcriptionOutput.id,
		originalFilename: transcriptionOutput.originalFilename,
		transcriptKeys: {
			srt: transcriptionOutput.outputBucketKeys.srt,
			text: transcriptionOutput.outputBucketKeys.text,
			json: transcriptionOutput.outputBucketKeys.json,
		},
		userEmail: transcriptionOutput.userEmail,
		completedAt: new Date().toISOString(),
		isTranslation: transcriptionOutput.isTranslation,
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
			`${transcriptionOutput.isTranslation ? 'English translation' : 'Transcription'} complete for ${transcriptionOutput.originalFilename}`,
			successMessageBody(
				transcriptionOutput.id,
				transcriptionOutput.originalFilename,
				config.app.rootUrl,
				transcriptionOutput.isTranslation,
				sourceMediaDownloadUrl,
			),
		);

		logger.info('Output handler successfully sent success email notification', {
			id: transcriptionOutput.id,
			filename: transcriptionOutput.originalFilename,
			userEmail: transcriptionOutput.userEmail,
		});
	} catch (error) {
		logger.error(
			'Failed to process success sqs message - transcription data may be missing from dynamo or email failed to send',
			error,
		);
		await metrics.putMetric(FailureMetric);
	}
};

const handleTranscriptionFailure = async (
	config: TranscriptionConfig,
	transcriptionOutput: TranscriptionOutputFailure,
	sesClient: SESClient,
	metrics: MetricsService,
	sourceMediaDownloadUrl: string,
) => {
	try {
		await sendEmail(
			sesClient,
			config.app.emailNotificationFromAddress,
			transcriptionOutput.userEmail,
			`${transcriptionOutput.isTranslation ? 'English translation ' : 'Transcription'} failed for ${transcriptionOutput.originalFilename}`,
			failureMessageBody(
				transcriptionOutput.originalFilename,
				transcriptionOutput.id,
				transcriptionOutput.isTranslation,
				sourceMediaDownloadUrl,
			),
		);

		logger.info('Output handler successfully sent failure email notification', {
			id: transcriptionOutput.id,
			filename: transcriptionOutput.originalFilename,
			userEmail: transcriptionOutput.userEmail,
		});
	} catch (error) {
		logger.error('Failed to process sqs failure message', error);
		await metrics.putMetric(FailureMetric);
	}
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
		logger.error(
			`Failed to parse SQS message ${parsedEvent.error.message} + ${JSON.stringify(event)}`,
			event,
		);
		throw new Error('Failed to parse SQS message');
	}

	for (const record of parsedEvent.data.Records) {
		const transcriptionOutput = record.body;
		const sourceMediaDownloadUrl = await getSignedDownloadUrl(
			config.aws.region,
			config.app.sourceMediaBucket,
			transcriptionOutput.id,
			7 * 24 * 60 * 60,
		);
		if (transcriptionOutputIsSuccess(transcriptionOutput)) {
			logger.info('handling transcription success');
			await handleTranscriptionSuccess(
				config,
				transcriptionOutput,
				sesClient,
				metrics,
				sourceMediaDownloadUrl,
			);
		} else if (transcriptionOutputIsTranscriptionFailure(transcriptionOutput)) {
			logger.info('handling transcription failure');
			await handleTranscriptionFailure(
				config,
				transcriptionOutput,
				sesClient,
				metrics,
				sourceMediaDownloadUrl,
			);
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
