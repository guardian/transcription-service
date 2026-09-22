import {
	OcrJob,
	OcrOutput,
	OcrOutputSuccess,
	uploadToS3,
} from '@guardian/transcription-service-common';
import {
	logger,
	publishTranscriptionOutput,
	runSpawnCommand,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import fs from 'node:fs';
import { MessageAttributeValue, SQSClient } from '@aws-sdk/client-sqs';

const OUTPUT_SIZE_LIMIT_GB = 10;
const OUTPUT_SIZE_LIMIT = OUTPUT_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 10GB

export const processOcrJob = async (
	job: OcrJob,
	downloadedFilePath: string,
	config: TranscriptionConfig,
	sqsClient: SQSClient,
	setMessageVisibility: (visibilityTimeoutSeconds: number) => Promise<void>,
	messageAttributes?: Record<string, MessageAttributeValue>,
) => {
	const pdfFileSizeBytes = fs.statSync(downloadedFilePath).size;
	const pdfFileSizeMB = Math.ceil(pdfFileSizeBytes / (1024 * 1024));
	// use pdfinfo to get the page count
	let pdfInfoOut = '';
	await runSpawnCommand(
		'pdfinfo',
		'pdfinfo',
		[downloadedFilePath],
		false,
		true,
		(data) => {
			if ('stdout' in data) {
				pdfInfoOut += data.stdout;
			}
		},
	);
	const pageNumRegex = /^Pages:\s+(\d+)/m;
	const match = pdfInfoOut.match(pageNumRegex);
	const numPages = match && match[1] ? parseInt(match[1], 10) : undefined;
	// 10 second per page or 120 seconds per megabyte
	const estimatedOcrTimeSeconds = numPages
		? numPages * 10
		: pdfFileSizeMB * 120;

	await setMessageVisibility(estimatedOcrTimeSeconds);

	const pdfOutputPath = `${downloadedFilePath}.ocr.pdf`;
	const base64OutputPath = `${pdfOutputPath}.base64`;

	const configPath =
		config.app.stage === 'DEV'
			? 'rapidocr/rapidocr-config.local.yaml'
			: '/opt/transcription-service/rapidocr-config.prod.yaml';

	await runSpawnCommand('ocrmypdf', 'ocrmypdf', [
		'--redo-ocr',
		'--plugin',
		'ocrmypdf_rapidocr',
		'--rapidocr-config-path',
		configPath,
		'-l',
		job.settings.ocrLanguage,
		downloadedFilePath,
		pdfOutputPath,
	]);

	await runSpawnCommand('base64', 'base64', [
		'-i',
		pdfOutputPath,
		'-o',
		base64OutputPath,
	]);

	const base64FileSize = fs.statSync(base64OutputPath).size;

	// the transcription service runs on instances with 16gb memory so let's error on anything bigger than 10GB to allow
	// some headroom
	if (base64FileSize > OUTPUT_SIZE_LIMIT) {
		throw new Error(
			`OCR output file too large to load into memory (larger than ${OUTPUT_SIZE_LIMIT_GB}GB). Giving up ocr job.`,
		);
	}

	const ocrOutput: OcrOutput = {
		outputPdfBase64: fs.readFileSync(base64OutputPath, 'utf-8'),
	};
	const uploadResult = await uploadToS3(
		job.combinedOutputUrl.url,
		Buffer.from(JSON.stringify(ocrOutput)),
		false, // gzip as, especially results from giant document translations, output will be quite large
	);
	if (!uploadResult.isSuccess) {
		throw new Error(
			`Could not upload OCR results to S3! ${uploadResult.errorMsg}`,
		);
	}
	logger.info('Successfully uploaded OCR results to S3');

	const output: OcrOutputSuccess = {
		status: 'OCR_SUCCESS',
		id: job.id,
		userEmail: job.userEmail,
		outputKey: job.combinedOutputUrl.key,
	};

	await publishTranscriptionOutput(
		sqsClient,
		config.app.destinationQueueUrls[job.transcriptDestinationService],
		output,
		messageAttributes,
	);

	logger.info(
		`Worker successfully processed OCR job and sent notification to ${job.transcriptDestinationService} output queue`,
		{
			id: output.id,
			userEmail: output.userEmail,
		},
	);
};
