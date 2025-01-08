import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import { google, drive_v3, docs_v1 } from 'googleapis';
import {
	logger,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { ZTokenResponse } from '@guardian/transcription-service-common';
import * as fs from 'node:fs';
import Drive = drive_v3.Drive;

const ROOT_FOLDER_NAME = 'Guardian Transcribe Tool';

export const getOrCreateFolder = async (
	drive: drive_v3.Drive,
	folderName: string,
	parentId?: string,
) => {
	const fileMetadata = {
		name: folderName,
		mimeType: 'application/vnd.google-apps.folder',
		parents: parentId ? [parentId] : [],
	};
	try {
		// first see if there is already a folder matching folderName
		const existingFolders = await drive.files.list({
			q: `mimeType='${fileMetadata.mimeType}' and name ='${folderName}' and trashed=false ${parentId ? `and '${parentId}' in parents` : ''}`,
			spaces: 'drive',
		});
		// there could be multiple folders with this name, let's upload to the first one
		const [firstMatch] = existingFolders.data.files ?? [];
		if (firstMatch) {
			return firstMatch.id;
		}

		// create a new folder
		const file = await drive.files.create({
			requestBody: fileMetadata,
			fields: 'id',
		});
		return file.data.id;
	} catch (err) {
		logger.error('Failed to create folder', err);
		return null;
	}
};

export const uploadToGoogleDocs = async (
	drive: drive_v3.Drive,
	docs: docs_v1.Docs,
	folderId: string,
	fileName: string,
	text: string,
): Promise<string> => {
	// Create using the Drive API
	const createResponse = await drive.files.create({
		supportsAllDrives: true,
		requestBody: {
			mimeType: 'application/vnd.google-apps.document',
			name: fileName,
			parents: [folderId],
		},
	});

	if (!createResponse.data.id) {
		throw new Error('Failed to create document');
	}
	await docs.documents.batchUpdate({
		documentId: createResponse.data.id,
		requestBody: {
			requests: [
				{
					insertText: {
						text: fileName,
						location: {
							index: 1,
						},
					},
				},
				{
					insertText: {
						text: '\n' + text,
						endOfSegmentLocation: {
							segmentId: null,
						},
					},
				},
				{
					updateParagraphStyle: {
						paragraphStyle: {
							namedStyleType: 'HEADING_1',
						},
						fields: 'namedStyleType',
						range: {
							startIndex: 1,
							endIndex: fileName.length,
						},
					},
				},
			],
		},
	});
	return createResponse.data.id;
};

export const getDriveClients = async (
	config: TranscriptionConfig,
	oAuthTokenResponse: ZTokenResponse,
) => {
	const oAuth2Client: OAuth2Client = new google.auth.OAuth2(config.auth);
	oAuth2Client.setCredentials(oAuthTokenResponse);

	const drive = google.drive({ version: 'v3', auth: oAuth2Client });
	const docs = google.docs({ version: 'v1', auth: oAuth2Client });
	return {
		drive,
		docs,
	};
};

export const createExportFolder = async (drive: Drive, name: string) => {
	const rootFolderId = await getOrCreateFolder(drive, ROOT_FOLDER_NAME);
	if (!rootFolderId) {
		logger.error(`Failed to get or create root folder '${ROOT_FOLDER_NAME}'`);
		return undefined;
	}
	const folderId = await getOrCreateFolder(drive, name, rootFolderId);
	if (!folderId) {
		logger.error(`Failed to get or create folder '${name}'`);
		return undefined;
	}
	return folderId;
};

export const uploadFileToGoogleDrive = async (
	fileName: string,
	oAuthTokenResponse: ZTokenResponse,
	filePath: string,
	mimeType: string,
	folderId: string,
) => {
	const fileSize = fs.statSync(filePath).size;

	const startResumableSessionResponse = await fetch(
		'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
		{
			method: 'POST',
			headers: {
				'X-Upload-Content-Length': `${fileSize}`,
				'X-Upload-Content-Type': mimeType,
				'Content-Type': 'application/json',
				Authorization: `Bearer ${oAuthTokenResponse.access_token}`,
			},
			body: JSON.stringify({
				name: fileName,
				mimeType,
				parents: [folderId],
			}),
		},
	);

	const uploadUrl = startResumableSessionResponse.headers.get('location');

	if (!uploadUrl) {
		throw new Error('Failed to start resumable upload session');
	}

	//when changing this value consider the amount of memory allocated to the API lambda function
	const CHUNK_SIZE = 128 * 1024 * 1024; // 128MB -
	const fileStream = fs.createReadStream(filePath, {
		highWaterMark: CHUNK_SIZE,
	});

	let offset = 0;

	for await (const chunk of fileStream) {
		const chunkSize = chunk.length;
		const range = `bytes ${offset}-${offset + chunkSize - 1}/${fileSize}`;

		logger.info(
			`Uploading chunk: ${range} (Upload ${Math.floor((offset / fileSize) * 100)}% complete)`,
		);

		const response = await fetch(uploadUrl, {
			method: 'PUT',
			headers: {
				'Content-Range': range,
				'Content-Length': chunkSize,
			},
			body: chunk,
		});

		if (response.ok) {
			// Response status is 308 until the final chunk. Final response includes file metadata
			return ((await response.json()) as { id: string }).id;
		}
		if (response.status !== 308) {
			const text = await response.text();
			logger.error(`Received ${response.status} from google, error: ${text}`);
			throw new Error(
				`Failed to upload chunk: ${response.status} ${response.statusText}`,
			);
		}

		offset += chunkSize;
	}
	throw new Error('Failed to upload file');
};
