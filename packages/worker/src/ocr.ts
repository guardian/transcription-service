import {
	OcrData,
	OcrJob,
	OcrMyPdfFailureReason,
	OcrOutputFailure,
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
import path from 'path';

const OUTPUT_SIZE_LIMIT_GB = 10;
const ONE_MB = 1024 * 1024;
const OUTPUT_SIZE_LIMIT = OUTPUT_SIZE_LIMIT_GB * 1024 * ONE_MB; // 10GB

type OcrOutputData = {
	language: string;
	base64OutPath: string;
	totalBase64Size: number;
};

export type OcrMyPdfSuccess = {
	isSuccess: true;
	outputPath: string;
};

export type OcrMyPdfFailure = {
	isSuccess: false;
	failureReason: OcrMyPdfFailureReason;
	message: string;
};

export type OcrMyPdfResult = OcrMyPdfSuccess | OcrMyPdfFailure;

export const ocrFailureOutput = (
	job: OcrJob,
	failure: OcrMyPdfFailure,
): OcrOutputFailure => ({
	id: job.id,
	userEmail: job.userEmail,
	status: 'OCR_FAILURE',
	failureReason: failure.failureReason,
	message: failure.message,
});

const exitCodeFailures: Record<
	number,
	{ status: OcrMyPdfFailureReason; statusMessage: string }
> = {
	1: { status: 'BAD_ARGS', statusMessage: 'Invalid arguments.' },
	2: {
		status: 'INPUT_FILE',
		statusMessage: 'The input file does not seem to be a valid PDF.',
	},
	3: {
		status: 'MISSING_DEPENDENCY',
		statusMessage: 'An external program required by OCRmyPDF is missing.',
	},
	5: {
		status: 'FILE_ACCESS_ERROR',
		statusMessage:
			'Insufficient permissions to read the input or write the output.',
	},
	6: {
		status: 'ALREADY_DONE_OCR',
		statusMessage: 'The file already appears to contain text.',
	},
	7: {
		status: 'CHILD_PROCESS_ERROR',
		statusMessage: 'An OCRmyPDF child process failed.',
	},
	8: {
		status: 'ENCRYPTED_PDF',
		statusMessage: 'The input PDF is encrypted and could not be decrypted.',
	},
	9: {
		status: 'INVALID_CONFIG',
		statusMessage: 'Tesseract rejected its configuration.',
	},
	15: {
		status: 'OTHER_ERROR',
		statusMessage: 'OCRmyPDF failed with an unspecified error.',
	},
};

export const checkNeedsRgbConversion = async (
	sourceFile: string,
): Promise<boolean> => {
	const probe = await runSpawnCommand(
		'ocrmypdf',
		'ocrmypdf',
		[
			'--skip-text',
			'--output-type',
			'pdfa',
			// just check the first page of the PDF
			'--pages',
			'1',
			// disable ocr
			'--tesseract-timeout',
			'0',
			sourceFile,
			'/dev/null',
		],
		false,
		false,
	);
	return [probe.stdout, probe.stderr].some((output) =>
		output.includes('ColorConversionNeededError:'),
	);
};

export const runOcrMyPdf = async (
	job: OcrJob,
	language: string,
	sourceFile: string,
	stage: string,
	workingDirectory: string,
): Promise<OcrMyPdfResult> => {
	const pdfOutputPath = path.join(
		workingDirectory,
		`${path.basename(sourceFile)}.${language}.ocr.pdf`,
	);
	const configPath =
		stage === 'DEV'
			? 'rapidocr/rapidocr-config.local.yaml'
			: '/opt/transcription-service/rapidocr-config.prod.yaml';
	const needsRgbConversion = await checkNeedsRgbConversion(sourceFile);

	const process = async (
		ocrMyPdfMode: string,
		retriedExitCodes: ReadonlySet<number> = new Set(),
		input: string = sourceFile,
	): Promise<OcrMyPdfResult> => {
		const dpiArg = job.settings.dpi
			? ['--image-dpi', String(job.settings.dpi)]
			: [];
		const result = await runSpawnCommand(
			'ocrmypdf',
			'ocrmypdf',
			[
				ocrMyPdfMode,
				...(needsRgbConversion ? ['--color-conversion-strategy=RGB'] : []),
				'--plugin',
				'ocrmypdf_rapidocr',
				'--rapidocr-config-path',
				configPath,
				'-l',
				language,
				...dpiArg,
				input,
				pdfOutputPath,
			],
			false,
			false,
		);
		const { code } = result;
		// 0: success
		// 4: "An output file was created, but it does not seem to be a valid PDF. The file will be available."
		// 10: "A valid PDF was created, PDF/A conversion failed. The file will be available."
		// These both produce an output file (they're more like warnings than failures)
		// so we want to return the file instead of throwing an exception.
		if (code === 0 || code === 4 || code === 10) {
			return { isSuccess: true, outputPath: pdfOutputPath };
		}
		if (code === 2 && !retriedExitCodes.has(2)) {
			logger.info(
				`Retrying OCR in ${language} with --skip-text after an input file error`,
			);
			return process('--skip-text', new Set([...retriedExitCodes, 2]), input);
		}
		if (code === 8 && !retriedExitCodes.has(8)) {
			const decryptedPath = path.join(
				workingDirectory,
				`${path.basename(sourceFile)}.${language}.decrypt.pdf`,
			);
			const decrypted = await runSpawnCommand(
				'qpdf',
				'qpdf',
				['--decrypt', sourceFile, decryptedPath],
				false,
				false,
			);
			if (decrypted.code === 0) {
				logger.info(`Retrying OCR in ${language} after decrypting the PDF`);
				return process(
					'--redo-ocr',
					new Set([...retriedExitCodes, 8]),
					decryptedPath,
				);
			}
			return {
				isSuccess: false,
				failureReason: 'ENCRYPTED_PDF',
				message: `OCRmyPDF exited with code 8; qpdf could not decrypt the input (exit code ${decrypted.code}). ${decrypted.stderr.slice(-8000)}`,
			};
		}
		if (code === undefined) {
			return {
				isSuccess: false,
				failureReason: 'OTHER_ERROR',
				message: `Failed to get exit code from ocrmypdf`,
			};
		}
		const failure = exitCodeFailures[code];
		return {
			isSuccess: false,
			failureReason: failure ? failure.status : 'OTHER_ERROR',
			message: `OCRmyPDF exited with code ${code} for ${language}: ${failure ? failure.statusMessage : ''} ${result.stderr.slice(-8000)}`,
		};
	};
	return process(job.settings.initialFlag ?? '--redo-ocr');
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

const getNumPages = async (sourceFile: string): Promise<number | undefined> => {
	const pdfInfo = await runSpawnCommand(
		'pdfinfo',
		'pdfinfo',
		[sourceFile],
		false,
		false,
	);
	const pdfInfoOut = pdfInfo.stdout;
	const pageNumRegex = /^Pages:\s+(\d+)/m;
	const match = pdfInfoOut.match(pageNumRegex);
	return match && match[1] ? parseInt(match[1], 10) : undefined;
};

export const runOcrJob = async (
	job: OcrJob,
	downloadedFilePath: string,
	workingDirectory: string,
	config: TranscriptionConfig,
	sqsClient: SQSClient,
	setMessageVisibility: (visibilityTimeoutSeconds: number) => Promise<void>,
	messageAttributes?: Record<string, MessageAttributeValue>,
): Promise<OcrMyPdfFailure | void> => {
	const pdfFileSizeBytes = fs.statSync(downloadedFilePath).size;

	const pdfFileSizeMB = Math.ceil(pdfFileSizeBytes / (1024 * 1024));

	const numPages = await getNumPages(downloadedFilePath);
	// 10 seconds per page or 120 seconds per megabyte. Each language requires a separate ocr job
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
			const result = await runOcrMyPdf(
				job,
				language,
				downloadedFilePath,
				config.app.stage,
				ocrDirectory,
			);
			if (!result.isSuccess) return result;

			const base64OutputPath = await copyFileAsBase64(
				result.outputPath,
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
	} finally {
		fs.rmSync(ocrDirectory, { recursive: true, force: true });
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
