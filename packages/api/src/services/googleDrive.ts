import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import { google, drive_v3, docs_v1 } from 'googleapis';
import { TranscriptionConfig } from '@guardian/transcription-service-backend-common';
import { ZTokenResponse } from '@guardian/transcription-service-common';

export const createTranscriptFolder = async (
	drive: drive_v3.Drive,
	folderName: string,
) => {
	const fileMetadata = {
		name: folderName,
		mimeType: 'application/vnd.google-apps.folder',
	};
	try {
		const file = await drive.files.create({
			requestBody: fileMetadata,
			fields: 'id',
		});
		console.log('Folder Id:', file.data.id);
		return file.data.id;
	} catch (err) {
		console.error('Failed to create folder', err);
		throw err;
	}
};

export const uploadToGoogleDocs = async (
	drive: drive_v3.Drive,
	docs: docs_v1.Docs,
	folderId: string,
	fileName: string,
	text: string,
): Promise<string> => {
	console.log(fileName, text);
	// Create using the Drive API
	const createResponse = await drive.files.create({
		supportsAllDrives: true,
		requestBody: {
			mimeType: 'application/vnd.google-apps.document',
			name: fileName,
			parents: [folderId],
		},
	});

	if (createResponse.data.id) {
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
					// {
					//     updateParagraphStyle: {
					//         paragraphStyle: {
					//             namedStyleType: "NORMAL_TEXT"
					//         },
					//         fields: "namedStyleType",
					//         range: {
					//             startIndex: fileName.length,
					//             endIndex: text.length+1
					//         }
					//     }
					// },
				],
			},
		});
		return createResponse.data.id;
	}
	throw new Error('Failed to create document');
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

	const folderId = await createTranscriptFolder(
		drive,
		'Guardian Transcribe Tool',
	);
	if (folderId) {
		const docId = await uploadToGoogleDocs(
			drive,
			docs,
			folderId,
			fileName,
			transcriptText,
		);
		return docId;
	}
	return null;
};
