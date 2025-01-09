import {
	downloadObject,
	getObjectSize,
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
	ZTokenResponse,
} from '@guardian/transcription-service-common';
import {
	uploadFileToGoogleDrive,
	uploadToGoogleDocs,
} from './services/googleDrive';
import { S3Client } from '@aws-sdk/client-s3';
import { LAMBDA_MAX_EPHEMERAL_STORAGE_BYTES } from '@guardian/transcription-service-backend-common/src/lambda';
import { docs_v1, drive_v3 } from 'googleapis';
import Drive = drive_v3.Drive;
import Docs = docs_v1.Docs;

export const exportMediaToDrive = async (
	config: TranscriptionConfig,
	s3Client: S3Client,
	item: TranscriptionDynamoItem,
	oAuthTokenResponse: ZTokenResponse,
	folderId: string,
): Promise<ExportStatus> => {
	const mediaSize = await getObjectSize(
		s3Client,
		config.app.sourceMediaBucket,
		item.id,
	);
	if (mediaSize && mediaSize > LAMBDA_MAX_EPHEMERAL_STORAGE_BYTES) {
		const msg = `Media file too large to export to google drive. Please manually download the file and upload using the google drive UI`;
		return {
			exportType: 'source-media',
			status: 'failure',
			message: msg,
		};
	}
	const filePath = `/tmp/${item.id.split('/')[1]}`;
	const { extension } = await downloadObject(
		s3Client,
		config.app.sourceMediaBucket,
		item.id,
		filePath,
	);

	const mimeType = 'application/octet-stream';

	// default to mp4 on the assumption that most media exported will be video
	const extensionOrMp4 = extension || 'mp4';

	const fileName = item.originalFilename.endsWith(`.${extensionOrMp4}`)
		? item.originalFilename
		: `${item.originalFilename}.${extensionOrMp4 || 'mp4'}`;

	const id = await uploadFileToGoogleDrive(
		fileName,
		oAuthTokenResponse,
		filePath,
		mimeType,
		folderId,
	);
	return {
		exportType: 'source-media',
		id,
		status: 'success',
	};
};

export const exportTranscriptToDoc = async (
	config: TranscriptionConfig,
	s3Client: S3Client,
	item: TranscriptionDynamoItem,
	format: 'srt' | 'text',
	folderId: string,
	drive: Drive,
	docs: Docs,
): Promise<ExportStatus> => {
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
		return {
			status: 'failure',
			message: msg,
			exportType: format,
		};
	}
	const exportResult = await uploadToGoogleDocs(
		drive,
		docs,
		folderId,
		`${item.originalFilename} transcript${format === 'srt' ? ' with timecodes' : ''} ${item.isTranslation ? ' (English translation)' : ''}`,
		transcriptText.text,
	);
	if (!exportResult) {
		const msg = `Failed to create google document for item with id ${item.id}`;
		logger.error(msg);
		return {
			status: 'failure',
			message: msg,
			exportType: format,
		};
	}
	return {
		status: 'success',
		id: exportResult,
		exportType: format,
	};
};

export const exportStatusInProgress = (items: ExportItems): ExportStatuses => {
	return items.map((item: ExportType) => ({
		status: 'in-progress',
		exportType: item,
	}));
};

export const updateStatus = (
	status: ExportStatus,
	statuses: ExportStatuses,
): ExportStatuses => {
	return statuses.map((s) => (s.exportType === status.exportType ? status : s));
};
