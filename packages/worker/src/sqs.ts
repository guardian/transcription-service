import { SQSClient } from '@aws-sdk/client-sqs';
import {
	TranscriptionJob,
	TranscriptionOutputFailure,
} from '@guardian/transcription-service-common';
import {
	logger,
	publishTranscriptionOutput,
} from '@guardian/transcription-service-backend-common';

export const publishTranscriptionOutputFailure = async (
	sqsClient: SQSClient,
	destination: string,
	job: TranscriptionJob,
) => {
	logger.info(`Sending failure message to ${destination}`);
	const failureMessage: TranscriptionOutputFailure = {
		id: job.id,
		status: 'TRANSCRIPTION_FAILURE',
		userEmail: job.userEmail,
		originalFilename: job.originalFilename,
		isTranslation: job.translate,
		engine: job.engine,
	};
	try {
		await publishTranscriptionOutput(sqsClient, destination, failureMessage);
	} catch (e) {
		logger.error(`error publishing failure message to ${destination}`, e);
	}
};
