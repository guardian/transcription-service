import {
	OcrData,
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

	const configPath =
		config.app.stage === 'DEV'
			? 'rapidocr/rapidocr-config.local.yaml'
			: '/opt/transcription-service/rapidocr-config.prod.yaml';

	const ocrData: OcrData[] = [];
	let totalBase64Size = 0;
	// Run languages separately, as each produces its own PDF and text layer.
	for (const [index, language] of job.settings.ocrLanguages.entries()) {
		await setMessageVisibility(
			Math.min(
				43200,
				Math.max(
					60,
					estimatedOcrTimeSeconds * (job.settings.ocrLanguages.length - index),
				),
			),
		);
		const pdfOutputPath = `${downloadedFilePath}.${index}.ocr.pdf`;
		const base64OutputPath = `${pdfOutputPath}.base64`;
		try {
			await runSpawnCommand('ocrmypdf', 'ocrmypdf', [
				job.settings.initialFlag ?? '--redo-ocr',
				'--plugin',
				'ocrmypdf_rapidocr',
				'--rapidocr-config-path',
				configPath,
				'-l',
				language,
				...(job.settings.dpi === undefined
					? []
					: ['--image-dpi', String(job.settings.dpi)]),
				downloadedFilePath,
				pdfOutputPath,
			]);

			// Use redirection because GNU (Linux) and BSD (macOS) base64 flags differ.
			await runSpawnCommand('base64', 'sh', [
				'-c',
				'base64 < "$1" > "$2"',
				'base64',
				pdfOutputPath,
				base64OutputPath,
			]);

			totalBase64Size += fs.statSync(base64OutputPath).size;
			// Apply the memory guard to the combined output across all languages.
			if (totalBase64Size > OUTPUT_SIZE_LIMIT) {
				throw new Error(
					`OCR output file too large to load into memory (larger than ${OUTPUT_SIZE_LIMIT_GB}GB). Giving up ocr job.`,
				);
			}
			ocrData.push({
				language,
				pdfBase64: fs.readFileSync(base64OutputPath, 'utf-8'),
			});
		} finally {
			fs.rmSync(pdfOutputPath, { force: true });
			fs.rmSync(base64OutputPath, { force: true });
		}
	}

	const ocrOutput: OcrOutput = { ocrData };
	const uploadResult = await uploadToS3(
		job.combinedOutputUrl.url,
		Buffer.from(JSON.stringify(ocrOutput)),
		false, // OCR output is plain JSON; Giant reads it without gzip decoding
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
