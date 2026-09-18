import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
	getObjectText,
	getS3Client,
	isS3Failure,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import {
	getDynamoClient,
	writeDynamoItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import {
	OcrDynamoItem,
	OcrOutput,
	OcrOutputFailure,
	OcrOutputSuccess,
} from '@guardian/transcription-service-common';

export const decodeOcrPdf = (text: string): Buffer => {
	const { outputPdfBase64 } = OcrOutput.parse(JSON.parse(text));
	const base64 = outputPdfBase64.replace(/\s/g, '');
	const pdf = Buffer.from(base64, 'base64');
	if (
		pdf.toString('base64') !== base64 ||
		pdf.subarray(0, 5).toString() !== '%PDF-'
	) {
		throw new Error('OCR output does not contain a valid base64 PDF');
	}
	return pdf;
};

export const handleOcrOutput = async (
	config: TranscriptionConfig,
	output: OcrOutputSuccess | OcrOutputFailure,
) => {
	const base = {
		id: output.id,
		userEmail: output.userEmail,
		completedAt: new Date().toISOString(),
	};
	let item: OcrDynamoItem;
	if (output.status === 'OCR_FAILURE') {
		item = {
			...base,
			status: 'OCR_FAILURE',
			errorMessage: 'OCR processing failed',
		};
	} else {
		const client = getS3Client(config.aws);
		const result = await getObjectText(
			client,
			config.app.transcriptionOutputBucket,
			output.outputKey,
			false,
		);
		if (isS3Failure(result)) throw new Error('Failed to download OCR output');
		const pdf = decodeOcrPdf(result.text);
		const outputKey = `${output.id}.ocr.pdf`;
		await client.send(
			new PutObjectCommand({
				Bucket: config.app.transcriptionOutputBucket,
				Key: outputKey,
				Body: pdf,
				ContentType: 'application/pdf',
			}),
		);
		item = { ...base, status: 'OCR_SUCCESS', outputKey };
	}
	// Persist completion only after the PDF upload succeeds. Errors propagate so SQS retries.
	await writeDynamoItem(
		getDynamoClient(config.aws, config.dev?.localstackEndpoint),
		config.app.tableName,
		item,
	);
};
