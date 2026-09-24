import {
	OcrData,
	OcrJob,
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
import path from 'path';

const OUTPUT_SIZE_LIMIT_GB = 10;
const OUTPUT_SIZE_LIMIT = OUTPUT_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 10GB

const runOcrMyPdf = async (
	job: OcrJob,
	language: string,
	sourceFile: string,
	stage: string,
	workingDirectory: string,
): Promise<string> => {
	const pdfOutputPath = `${workingDirectory}/${path.basename(sourceFile)}.${language}.ocr.pdf`;
	const configPath =
		stage === 'DEV'
			? 'rapidocr/rapidocr-config.local.yaml'
			: '/opt/transcription-service/rapidocr-config.prod.yaml';
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
		sourceFile,
		pdfOutputPath,
	]);
	return pdfOutputPath;
};

const copyFileAsBase64 = async (
	sourceFile: string,
	workingDirectory: string,
): Promise<string> => {
	const base64OutputPath = `${workingDirectory}/${path.basename(sourceFile)}.base64`;
	// Use redirection because GNU (Linux) and BSD (macOS) base64 flags differ.
	await runSpawnCommand('base64', 'sh', [
		'-c',
		'base64 < "$1" > "$2"',
		'base64',
		sourceFile,
		base64OutputPath,
	]);
	return base64OutputPath;
};

type OcrOutputData = {
	language: string;
	base64OutPath: string;
	totalBase64Size: number;
};

export const processOcrJob = async (
	job: OcrJob,
	downloadedFilePath: string,
	workingDirectory: string,
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
	// 10 second per page or 120 seconds per megabyte. Each language requires a separate ocr job
	const estimatedOcrTimeSeconds =
		job.settings.ocrLanguages.length *
		(numPages ? numPages * 10 : pdfFileSizeMB * 120);

	await setMessageVisibility(estimatedOcrTimeSeconds);
	const ocrOutputData: OcrOutputData[] = [];

	//make directory for intermediate files
	const ocrDirectory = `${workingDirectory}/ocr`;
	fs.mkdirSync(ocrDirectory, { recursive: true });

	// Run languages separately, as each produces its own PDF and text layer.
	try {
		for (const language of job.settings.ocrLanguages) {
			const ocrOutputPath = await runOcrMyPdf(
				job,
				language,
				downloadedFilePath,
				config.app.stage,
				ocrDirectory,
			);

			const base64OutputPath = await copyFileAsBase64(
				ocrOutputPath,
				ocrDirectory,
			);
			ocrOutputData.push({
				language,
				base64OutPath: base64OutputPath,
				totalBase64Size: fs.statSync(base64OutputPath).size,
			});
		}

		// Apply the memory guard to the combined output across all languages.
		const totalBase64Size = ocrOutputData.reduce(
			(acc, data) => acc + data.totalBase64Size,
			0,
		);
		if (totalBase64Size > OUTPUT_SIZE_LIMIT) {
			throw new Error(
				`OCR output file too large to load into memory (larger than ${OUTPUT_SIZE_LIMIT_GB}GB). Giving up ocr job.`,
			);
		}
		// here we load all the output PDFs into memory so we can wrap them in the JSON that gets uploaded to S3
		// (there's probably a way of streaming this, but I am optimistic that with 16gb of memory that will be enough for
		// even some giant multi gb pdfs needing ocring in multiple languages)
		const ocrData: OcrData[] = ocrOutputData.map(
			(outputData: OcrOutputData) => ({
				language: outputData.language,
				pdfBase64: fs.readFileSync(outputData.base64OutPath, 'utf-8'),
			}),
		);

		const uploadResult = await uploadToS3(
			job.combinedOutputUrl.url,
			Buffer.from(JSON.stringify(ocrData)),
			false, // OCR output is plain JSON; Giant reads it without gzip decoding
		);
		if (!uploadResult.isSuccess) {
			throw new Error(
				`Could not upload OCR results to S3! ${uploadResult.errorMsg}`,
			);
		}
		logger.info('Successfully uploaded OCR results to S3');
	} finally {
		fs.rmSync(ocrDirectory, { force: true });
	}

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
