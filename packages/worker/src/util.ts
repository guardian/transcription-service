import { logger } from '@guardian/transcription-service-backend-common';
import {
	uploadToS3,
	TranscriptionResult,
} from '@guardian/transcription-service-common';
import { gzip } from 'node-gzip';

export const uploadedCombinedResultsToS3 = async (
	combinedOutputUrl: string,
	result: TranscriptionResult,
) => {
	const gzippedResult: Buffer = await gzip(JSON.stringify(result));
	const response = await uploadToS3(combinedOutputUrl, gzippedResult, true);
	if (!response.isSuccess) {
		throw new Error(
			`Could not upload combined results to S3! ${response.errorMsg}`,
		);
	}
	logger.info(`Successfully uploaded combined results to S3`);
};
