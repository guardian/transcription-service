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
	writeDynamoItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import { testMessage } from '../test/testMessage';
import {
	transcriptionOutputIsSuccess,
	TranscriptionOutputSuccess,
	TranscriptionOutputFailure,
	transcriptionOutputIsTranscriptionFailure,
	TranscriptionDynamoItem,
	transcriptionOutputIsMediaDownloadFailure,
	MediaDownloadFailure,
	ONE_WEEK_IN_SECONDS,
	MediaDownloadFailureReason,
	ABOUT_THIS_TOOL_YOUTUBE,
} from '@guardian/transcription-service-common';
import {
	MetricsService,
	FailureMetric,
	secondsFromEnqueueToCompleteEmailSentMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { SESClient } from '@aws-sdk/client-ses';
import { sqsMessageToTestMessage } from 'webpage-snapshot/test/testMessage';

const successMessageBody = (
	transcriptId: string,
	originalFilename: string,
	rootUrl: string,
	isTranslation: boolean,
): string => {
	const exportUrl = `${rootUrl}/export?transcriptId=${transcriptId}`;
	const viewerUrl = `${rootUrl}/viewer?transcriptId=${transcriptId}`;
	return `
		<h1>${isTranslation ? 'English translation ' : 'Transcription'} for ${originalFilename} ready</h1>
		<p>Click <a href="${exportUrl}">here</a> to download or export transcript/input media to Google drive.</p>
		<p>Click <a href="${viewerUrl}">here</a> to view and play back your transcript.</p>
		<p>You may wish to open the playback view and the Google Document side by side to review the transcript and make corrections.</p>
		<p><b>Note:</b> transcripts and input media will be deleted from this service after 7 days. Export your data now if you want to keep it.</p>
	`;
};

const transcriptionFailureMessageBody = (
	originalFilename: string,
	id: string,
	isTranslation: boolean,
	sourceMediaDownloadUrl: string,
): string => {
	return `
		<h1>${isTranslation ? 'English translation ' : 'Transcription'}for ${originalFilename} has failed.</h1>
		<p>Please make sure that the file is a valid audio or video file.</p>
		<p>Click <a href="${sourceMediaDownloadUrl}">here</a> to download the input media.</p>
		<p>Contact digital.investigations@theguardian.com for support.</p>
		<p>Transcription ID: ${id}</p>
	`;
};

const failureDescription = (failureReason: MediaDownloadFailureReason) => {
	switch (failureReason) {
		case 'INVALID_URL':
			return `
					<p>Unfortunately, the tool doesn't currently support downloading media from this URL. For a list of supported sites, see
          <a href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md">here</a>.</p>
					`;
		case 'BOT_BLOCKED':
			return `<p>Unfortunately, YouTube blocked the download of this video. You will need to download the media 
manually (instructions <a href="${ABOUT_THIS_TOOL_YOUTUBE}" target="_blank"> here</a>)
 and then upload it using the 'File' upload option in the transcription tool.</p> `;
		default:
			return `<p>Unfortunately, an error occurred when trying to download the media from this URL for transcription.</p>`;
	}
};

const mediaDownloadFailureMessageBody = (
	url: string,
	failureReason: MediaDownloadFailureReason,
) => {
	return `
		<h1>Media download failed for ${url}</h1>
		<p>You recently requested a transcription of the media at this url ${url}.
		${failureDescription(failureReason)}
		<p>Please contact digital.investigations@theguardian.com for further assistance.</p>
		`;
};

const handleTranscriptionSuccess = async (
	config: TranscriptionConfig,
	transcriptionOutput: TranscriptionOutputSuccess,
	sesClient: SESClient,
	metrics: MetricsService,
) => {
	const dynamoItem: TranscriptionDynamoItem = {
		id: transcriptionOutput.id,
		originalFilename: transcriptionOutput.originalFilename,
		combinedOutputKey: transcriptionOutput.combinedOutputKey,
		userEmail: transcriptionOutput.userEmail,
		completedAt: new Date().toISOString(),
		isTranslation: transcriptionOutput.isTranslation,
		languageCode: transcriptionOutput.languageCode,
	};

	try {
		await writeDynamoItem(
			getDynamoClient(config.aws, config.dev?.localstackEndpoint),
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
			),
		);

		if (transcriptionOutput.maybeEnqueuedAtEpochMillis) {
			await metrics.putMetric(
				secondsFromEnqueueToCompleteEmailSentMetric(
					(Date.now() - transcriptionOutput.maybeEnqueuedAtEpochMillis) / 1000,
				),
			);
		}

		logger.info('Output handler sent success email notification', {
			id: transcriptionOutput.id,
			filename: transcriptionOutput.originalFilename,
			userEmail: transcriptionOutput.userEmail,
			duration: transcriptionOutput.duration || '',
			languageCode: transcriptionOutput.languageCode,
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
			transcriptionFailureMessageBody(
				transcriptionOutput.originalFilename,
				transcriptionOutput.id,
				transcriptionOutput.isTranslation,
				sourceMediaDownloadUrl,
			),
		);

		logger.info(
			'Output handler successfully sent transcription failure email notification',
			{
				id: transcriptionOutput.id,
				filename: transcriptionOutput.originalFilename,
				userEmail: transcriptionOutput.userEmail,
			},
		);
	} catch (error) {
		logger.error('Failed to process sqs failure message', error);
		await metrics.putMetric(FailureMetric);
	}
};

const handleMediaDownloadFailure = async (
	config: TranscriptionConfig,
	failure: MediaDownloadFailure,
	sesClient: SESClient,
	metrics: MetricsService,
) => {
	try {
		await sendEmail(
			sesClient,
			config.app.emailNotificationFromAddress,
			failure.userEmail,
			`Media download failed for ${failure.url}`,
			mediaDownloadFailureMessageBody(failure.url, failure.failureReason),
		);

		logger.info(
			'Output handler successfully sent media download failure email notification',
			{
				id: failure.id,
				url: failure.url,
				userEmail: failure.userEmail,
			},
		);
	} catch (error) {
		logger.error('Failed to process sqs failure message', error);
		await metrics.putMetric(FailureMetric);
	}
};

const processMessage = async (event: unknown) => {
	const config = await getConfig();
	const sesClient = getSESClient(config.aws);

	const metrics = new MetricsService(
		config.app.stage,
		config.aws,
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
		if (transcriptionOutputIsSuccess(transcriptionOutput)) {
			logger.info(`handling transcription success`);
			await handleTranscriptionSuccess(
				config,
				transcriptionOutput,
				sesClient,
				metrics,
			);
		} else if (transcriptionOutputIsTranscriptionFailure(transcriptionOutput)) {
			logger.info(
				`Handling transcription failure. Transcription output: ${JSON.stringify(transcriptionOutput)}`,
			);
			const sourceMediaDownloadUrl = await getSignedDownloadUrl(
				config.aws,
				config.app.sourceMediaBucket,
				transcriptionOutput.id,
				ONE_WEEK_IN_SECONDS,
				transcriptionOutput.originalFilename,
			);
			await handleTranscriptionFailure(
				config,
				transcriptionOutput,
				sesClient,
				metrics,
				sourceMediaDownloadUrl,
			);
		} else if (transcriptionOutputIsMediaDownloadFailure(transcriptionOutput)) {
			logger.info(
				`Handling media download failure. Output: ${JSON.stringify(transcriptionOutput)}`,
			);
			await handleMediaDownloadFailure(
				config,
				transcriptionOutput,
				sesClient,
				metrics,
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
	const messageBodyEnv = process.env['MESSAGE_BODY'];
	if (messageBodyEnv) {
		processMessage(sqsMessageToTestMessage(messageBodyEnv));
	} else {
		processMessage(testMessage);
	}
}
export { handler as outputHandler };
