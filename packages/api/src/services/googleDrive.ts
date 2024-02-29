import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import { google, drive_v3, docs_v1 } from 'googleapis';
import {
	logger,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { ZTokenResponse } from '@guardian/transcription-service-common';

export const getOrCreateTranscriptFolder = async (
	drive: drive_v3.Drive,
	folderName: string,
) => {
	const fileMetadata = {
		name: folderName,
		mimeType: 'application/vnd.google-apps.folder',
	};
	try {
		// first see if there is already a folder matching folderName
		const existingFolders = await drive.files.list({
			q: `mimeType='${fileMetadata.mimeType}' and name ='${folderName}' and trashed=false`,
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

export const createTranscriptDocument = async (
	config: TranscriptionConfig,
	fileName: string,
	oAuthTokenResponse: ZTokenResponse,
	transcriptText: string,
) => {
	const oAuth2Client: OAuth2Client = new google.auth.OAuth2(config.auth);
	oAuth2Client.setCredentials(oAuthTokenResponse);

	const drive = google.drive({ version: 'v3', auth: oAuth2Client });
	const docs = google.docs({ version: 'v1', auth: oAuth2Client });

	const folderId = await getOrCreateTranscriptFolder(
		drive,
		'Guardian Transcribe Tool',
	);
	if (!folderId) {
		logger.error('Failed to get or create folder');
		return undefined;
	}
	const docId = await uploadToGoogleDocs(
		drive,
		docs,
		folderId,
		fileName,
		transcriptText,
	);
	return docId;
};
