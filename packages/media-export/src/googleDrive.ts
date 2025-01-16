import { ZTokenResponse } from '@guardian/transcription-service-common';
import fs from 'node:fs';
import { logger } from '@guardian/transcription-service-backend-common';
import { z } from 'zod';

const DriveUploadResponse = z.object({
	id: z.string(),
});

export const uploadFileToGoogleDrive = async (
	fileName: string,
	oAuthTokenResponse: ZTokenResponse,
	filePath: string,
	mimeType: string,
	folderId: string,
): Promise<string> => {
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
		// pause the stream to prevent node from buffering any more data whilst we upload
		fileStream.pause();
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
			const jsonResp = await response.json();
			const validationResult = DriveUploadResponse.safeParse(jsonResp);
			if (!validationResult.success) {
				throw new Error(
					`Failed to parse response from google drive, resp:${jsonResp}, error: ${validationResult.error}`,
				);
			}
			return validationResult.data.id;
		}
		if (response.status === 308) {
			//continue
		} else {
			const text = await response.text();
			logger.error(`Received ${response.status} from google, error: ${text}`);
			throw new Error(
				`Failed to upload chunk: ${response.status} ${response.statusText}`,
			);
		}

		offset += chunkSize;
		fileStream.resume();
	}

	throw new Error('Failed to upload file');
};
