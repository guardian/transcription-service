import { authFetch } from '@/helpers';
import {
	OcrResult,
	SignedUrlResponseBody,
	uploadToS3,
} from '@guardian/transcription-service-common';

export const submitOcr = async (
	file: File,
	ocrLanguage: string,
	token: string,
): Promise<string> => {
	const response = await authFetch('/api/signed-url', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ fileName: file.name }),
	});
	if (!response.ok) throw new Error('Failed to prepare file upload');
	const { presignedS3Url, s3Key } = SignedUrlResponseBody.parse(
		await response.json(),
	);
	const upload = await uploadToS3(presignedS3Url, new Blob([file]), false);
	if (!upload.isSuccess) throw new Error('Failed to upload PDF');
	const submitted = await authFetch('/api/ocr', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ s3Key, fileName: file.name, ocrLanguage }),
	});
	if (!submitted.ok)
		throw new Error((await submitted.text()) || 'Failed to submit OCR job');
	const data = await submitted.json();
	if (typeof data.id !== 'string')
		throw new Error('Invalid OCR submission response');
	return data.id;
};

export const getOcrResult = async (
	id: string,
	token: string,
): Promise<OcrResult | undefined> => {
	const response = await authFetch(
		`/api/ocr?id=${encodeURIComponent(id)}`,
		token,
	);
	if (response.status === 404) return undefined;
	if (!response.ok)
		throw new Error(
			'Failed to fetch OCR result. Reload the page to try again.',
		);
	return OcrResult.parse(await response.json());
};
