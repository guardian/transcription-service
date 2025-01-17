import {
	getObjectText,
	isS3Failure,
	logger,
	TranscriptionConfig,
	TranscriptionDynamoItem,
} from '@guardian/transcription-service-backend-common';
import {
	ExportItems,
	ExportStatus,
	ExportStatuses,
	ExportType,
} from '@guardian/transcription-service-common';
import { uploadToGoogleDocs } from './services/googleDrive';
import { S3Client } from '@aws-sdk/client-s3';
import { docs_v1, drive_v3 } from 'googleapis';

export const exportTranscriptToDoc = async (
	config: TranscriptionConfig,
	s3Client: S3Client,
	item: TranscriptionDynamoItem,
	format: 'srt' | 'text',
	folderId: string,
	drive: drive_v3.Drive,
	docs: docs_v1.Docs,
): Promise<ExportStatus> => {
	logger.info(`Starting export, export type: ${format}`);
	const transcriptS3Key = item.transcriptKeys[format];
	const transcriptText = await getObjectText(
		s3Client,
		config.app.transcriptionOutputBucket,
		transcriptS3Key,
	);
	if (isS3Failure(transcriptText)) {
		if (transcriptText.failureReason === 'NoSuchKey') {
			const msg = `Failed to export transcript - file has expired. Please re-upload the file and try again.`;
			return {
				status: 'failure',
				message: msg,
				exportType: format,
			};
		}
		const msg = `Failed to fetch transcript. Please contact the digital investigations team for support`;
		logger.error(
			`Fetching from s3 failed, failure reason: ${transcriptText.failureReason}`,
		);
		return {
			status: 'failure',
			message: msg,
			exportType: format,
		};
	}
	try {
		const docId = await uploadToGoogleDocs(
			drive,
			docs,
			folderId,
			`${item.originalFilename} transcript${format === 'srt' ? ' with timecodes' : ''} ${item.isTranslation ? ' (English translation)' : ''}`,
			transcriptText.text,
		);
		logger.info(`Export of ${format} complete, file id: ${docId}`);
		return {
			status: 'success',
			id: docId,
			exportType: format,
		};
	} catch (error) {
		const msg = `Failed to create google document for item with id ${item.id}`;
		logger.error(`Creating google doc failed`, error);
		return {
			status: 'failure',
			message: msg,
			exportType: format,
		};
	}
};

export const initializeExportStatuses = (
	items: ExportItems,
): ExportStatuses => {
	return items.map((item: ExportType) => ({
		status: 'in-progress',
		exportType: item,
	}));
};

export const updateStatuses = (
	updatedStatus: ExportStatus,
	currentStatuses: ExportStatuses,
): ExportStatuses => {
	return currentStatuses.map((s) =>
		s.exportType === updatedStatus.exportType ? updatedStatus : s,
	);
};
