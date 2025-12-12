import {
	getObjectText,
	isS3Failure,
	logger,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import {
	DocExportType,
	ExportItems,
	ExportStatus,
	ExportStatuses,
	ExportType,
	getTranscriptDoc,
	isTranslationExport,
	TranscriptionDynamoItem,
	TranscriptionResult,
} from '@guardian/transcription-service-common';
import { uploadToGoogleDocs } from './services/googleDrive';
import { S3Client } from '@aws-sdk/client-s3';
import { docs_v1, drive_v3 } from 'googleapis';

type CombinedOutputFailure = {
	status: 'failure';
	failureReason: string;
};
type CombinedOutputSuccess = {
	status: 'success';
	data: TranscriptionResult;
};
type CombinedOutputResult = CombinedOutputFailure | CombinedOutputSuccess;

export const combinedOutputResultIsSuccess = (
	result: CombinedOutputResult,
): result is { status: 'success'; data: TranscriptionResult } => {
	return result.status === 'success';
};

export const getCombinedOutput = async (
	config: TranscriptionConfig,
	s3Client: S3Client,
	key: string,
): Promise<CombinedOutputResult> => {
	const combinedOutputText = await getObjectText(
		s3Client,
		config.app.transcriptionOutputBucket,
		key,
		true,
	);

	if (isS3Failure(combinedOutputText)) {
		const msg =
			combinedOutputText.failureReason === 'NoSuchKey'
				? `Failed to export transcript - file has expired. Please re-upload the file and try again.`
				: `Failed to fetch transcript. Please contact the digital investigations team for support`;
		logger.error(msg);
		return {
			status: 'failure',
			failureReason: msg,
		};
	}

	const result = TranscriptionResult.safeParse(
		JSON.parse(combinedOutputText.text),
	);
	if (result.success) {
		return {
			status: 'success',
			data: result.data,
		};
	} else {
		const msg = `Failed to parse combined output from S3 for key ${key}: ${result.error.message}`;
		logger.error(msg);
		return {
			status: 'failure',
			failureReason: msg,
		};
	}
};

export const exportTranscriptToDoc = async (
	item: TranscriptionDynamoItem,
	exportType: DocExportType,
	folderId: string,
	drive: drive_v3.Drive,
	docs: docs_v1.Docs,
	combinedOutput: TranscriptionResult,
): Promise<ExportStatus> => {
	logger.info(`Starting export, export type: ${exportType}`);
	const text = getTranscriptDoc(exportType, combinedOutput);
	if (!text) {
		const msg = `Couldn't find ${exportType} in transcript result}`;
		logger.error(msg);
		return {
			status: 'failure',
			message: msg,
			exportType: exportType,
		};
	}

	try {
		const docId = await uploadToGoogleDocs(
			drive,
			docs,
			folderId,
			`${item.originalFilename} transcript${exportType === 'srt' ? ' with timecodes' : ''} ${isTranslationExport(exportType) ? ' (English translation)' : ''}`,
			text,
		);
		logger.info(`Export of ${exportType} complete, file id: ${docId}`);
		return {
			status: 'success',
			id: docId,
			exportType: exportType,
		};
	} catch (error) {
		const msg = `Failed to create google document for item with id ${item.id}`;
		logger.error(`Creating google doc failed`, error);
		return {
			status: 'failure',
			message: msg,
			exportType: exportType,
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
