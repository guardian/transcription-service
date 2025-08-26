import {
	getObjectText,
	getSignedDownloadUrl,
	isS3Failure,
	logger,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import {
	DownloadUrls,
	ExportItems,
	ExportStatus,
	ExportStatuses,
	ExportType,
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
	config: TranscriptionConfig,
	s3Client: S3Client,
	item: TranscriptionDynamoItem,
	format: 'srt' | 'text',
	folderId: string,
	drive: drive_v3.Drive,
	docs: docs_v1.Docs,
	combinedOutput?: TranscriptionResult,
): Promise<ExportStatus> => {
	logger.info(`Starting export, export type: ${format}`);
	const transcriptS3Key = item.transcriptKeys[format];
	// FIXME use a mutable variable here as a temporary measure until the old non-combined format is removed
	let text: string;
	if (combinedOutput) {
		text = combinedOutput.transcripts[format];
	} else {
		const transcriptText = await getObjectText(
			s3Client,
			config.app.transcriptionOutputBucket,
			transcriptS3Key,
			false,
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
		text = transcriptText.text;
	}

	try {
		const docId = await uploadToGoogleDocs(
			drive,
			docs,
			folderId,
			`${item.originalFilename} transcript${format === 'srt' ? ' with timecodes' : ''} ${item.isTranslation ? ' (English translation)' : ''}`,
			text,
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

export const getDownloadUrls = async (
	config: TranscriptionConfig,
	item: TranscriptionDynamoItem,
): Promise<DownloadUrls> => {
	const text = await getSignedDownloadUrl(
		config.aws.region,
		config.app.transcriptionOutputBucket,
		item.transcriptKeys.text,
		60 * 60 * 12,
		`${item.originalFilename}.txt`,
	);
	const srt = await getSignedDownloadUrl(
		config.aws.region,
		config.app.transcriptionOutputBucket,
		item.transcriptKeys.srt,
		60 * 60 * 12,
		`${item.originalFilename}.srt`,
	);
	const sourceMedia = await getSignedDownloadUrl(
		config.aws.region,
		config.app.sourceMediaBucket,
		item.id,
		60 * 60 * 12,
		`${item.originalFilename}`,
	);
	return { text, srt, sourceMedia };
};
