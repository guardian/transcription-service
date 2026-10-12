import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
	DestinationService,
	OcrJob,
	OcrOutput,
	OcrOutputFailure,
	uploadToS3,
} from '@guardian/transcription-service-common';
import {
	publishTranscriptionOutput,
	runSpawnCommand,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { ocrFailureOutput, runOcrJob, runOcrMyPdf } from './ocr';

jest.mock('@guardian/transcription-service-common', () => ({
	...jest.requireActual('@guardian/transcription-service-common'),
	uploadToS3: jest.fn(),
}));
jest.mock('@guardian/transcription-service-backend-common', () => ({
	logger: { info: jest.fn(), error: jest.fn() },
	runSpawnCommand: jest.fn(),
	publishTranscriptionOutput: jest.fn(),
}));

const config = {
	app: { stage: 'DEV', destinationQueueUrls: { Giant: 'output-queue' } },
} as TranscriptionConfig;
const sqs = {} as SQSClient;
const attributes = {
	GiantIngestion: { DataType: 'String', StringValue: 'ingestion' },
	GiantExtractorName: {
		DataType: 'String',
		StringValue: 'ExternalOcrMyPdfExtractor',
	},
};

describe('runOcrJob', () => {
	let directory: string;
	let input: string;
	let job: OcrJob;
	const visibility = jest.fn();

	beforeEach(() => {
		jest.resetAllMocks();
		visibility.mockResolvedValue(undefined);
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-test-'));
		input = path.join(directory, 'input.pdf');
		fs.writeFileSync(input, 'source pdf');
		job = {
			id: 'blob',
			originalFilename: 'input.pdf',
			inputSignedUrl: 'input-url',
			sentTimestamp: 'now',
			userEmail: 'giant',
			transcriptDestinationService: DestinationService.Giant,
			combinedOutputUrl: { url: 'upload-url', key: 'result.json' },
			jobType: 'ocr',
			settings: {
				ocrLanguages: ['eng', 'fra'],
				initialFlag: '--skip-text',
				dpi: 300,
			},
		};
		jest.mocked(uploadToS3).mockResolvedValue({ isSuccess: true });
		jest
			.mocked(runSpawnCommand)
			.mockImplementation(async (name, _command, args) => {
				if (name === 'pdfinfo')
					return { code: 0, stdout: 'Pages: 10\n', stderr: '' };
				if (name === 'ocrmypdf' && args.includes('--plugin')) {
					fs.writeFileSync(
						args[args.length - 1]!,
						`pdf in ${args[args.indexOf('-l') + 1]}`,
					);
				}
				if (name === 'base64') {
					fs.writeFileSync(
						args[4]!,
						fs.readFileSync(args[3]!).toString('base64'),
					);
				}
				return { code: 0, stdout: '', stderr: '' };
			});
	});

	afterEach(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it('runs each language with the requested options and uploads language-tagged PDFs before publishing success', async () => {
		await runOcrJob(job, input, directory, config, sqs, visibility, attributes);
		const calls = jest
			.mocked(runSpawnCommand)
			.mock.calls.filter(
				([name, , args]) => name === 'ocrmypdf' && args.includes('--plugin'),
			);
		expect(calls).toHaveLength(2);
		for (const [i, language] of ['eng', 'fra'].entries()) {
			expect(calls[i]?.[2]).toEqual([
				'--skip-text',
				'--plugin',
				'ocrmypdf_rapidocr',
				'--rapidocr-config-path',
				'rapidocr/rapidocr-config.local.yaml',
				'-l',
				language,
				'--image-dpi',
				'300',
				input,
				path.join(directory, 'ocr', `input.pdf.${language}.ocr.pdf`),
			]);
		}
		const uploaded = OcrOutput.parse(
			JSON.parse(jest.mocked(uploadToS3).mock.calls[0]![1].toString()),
		);
		expect(
			uploaded.ocrData.map(({ language, pdfBase64 }) => [
				language,
				Buffer.from(pdfBase64, 'base64').toString(),
			]),
		).toEqual([
			['eng', 'pdf in eng'],
			['fra', 'pdf in fra'],
		]);
		expect(visibility.mock.calls).toEqual([[200]]);
		expect(publishTranscriptionOutput).toHaveBeenCalledWith(
			sqs,
			'output-queue',
			{
				status: 'OCR_SUCCESS',
				id: 'blob',
				userEmail: 'giant',
				outputKey: 'result.json',
			},
			attributes,
		);
		expect(jest.mocked(uploadToS3).mock.invocationCallOrder[0]).toBeLessThan(
			jest.mocked(publishTranscriptionOutput).mock.invocationCallOrder[0]!,
		);
		expect(fs.readdirSync(directory)).toEqual(['input.pdf']);
	});

	it('defaults to redo-ocr and discovers the page count using pdfinfo', async () => {
		job.settings = { ocrLanguages: ['eng'] };
		await runOcrJob(job, input, directory, config, sqs, visibility);
		expect(runSpawnCommand).toHaveBeenCalledWith(
			'pdfinfo',
			'pdfinfo',
			[input],
			false,
			false,
		);
		const args = jest
			.mocked(runSpawnCommand)
			.mock.calls.find(
				([name, , args]) => name === 'ocrmypdf' && args.includes('--plugin'),
			)![2];
		expect(args[0]).toBe('--redo-ocr');
		expect(args).not.toContain('--image-dpi');
		expect(visibility).toHaveBeenCalledWith(100);
	});

	it('does not upload a partial result or publish success when a language fails, and removes temporary files', async () => {
		const implementation = jest
			.mocked(runSpawnCommand)
			.getMockImplementation()!;
		jest.mocked(runSpawnCommand).mockImplementation(async (...args) => {
			if (args[0] === 'ocrmypdf' && args[2].includes('fra'))
				throw new Error('OCR failed');
			return implementation(...args);
		});
		await expect(
			runOcrJob(job, input, directory, config, sqs, visibility),
		).rejects.toThrow('OCR failed');
		expect(uploadToS3).not.toHaveBeenCalled();
		expect(publishTranscriptionOutput).not.toHaveBeenCalled();
		expect(fs.readdirSync(directory)).toEqual(['input.pdf']);
	});

	it('does not publish success if uploading fails', async () => {
		jest
			.mocked(uploadToS3)
			.mockResolvedValue({ isSuccess: false, errorMsg: 'upload failed' });
		await expect(
			runOcrJob(job, input, directory, config, sqs, visibility),
		).rejects.toThrow('upload failed');
		expect(publishTranscriptionOutput).not.toHaveBeenCalled();
		expect(fs.readdirSync(directory)).toEqual(['input.pdf']);
	});

	const ocrCalls = () =>
		jest
			.mocked(runSpawnCommand)
			.mock.calls.filter(
				([name, , args]) => name === 'ocrmypdf' && args.includes('--plugin'),
			);

	const returnOcrExitCodes = (codes: number[]) => {
		const implementation = jest
			.mocked(runSpawnCommand)
			.getMockImplementation()!;
		jest.mocked(runSpawnCommand).mockImplementation(async (...args) => {
			if (args[0] === 'ocrmypdf' && args[2].includes('--plugin')) {
				const code = codes.shift() ?? 0;
				if ([0, 4, 10].includes(code)) await implementation(...args);
				return { code, stdout: '', stderr: `diagnostic for ${code}` };
			}
			return implementation(...args);
		});
	};

	it('returns the output path in a successful OCR result', async () => {
		const outputPath = path.join(directory, 'input.pdf.eng.ocr.pdf');
		await expect(
			runOcrMyPdf(job, 'eng', input, config.app.stage, directory),
		).resolves.toEqual({ isSuccess: true, outputPath });
		expect(fs.readFileSync(outputPath, 'utf8')).toBe('pdf in eng');
	});

	it('returns a failure result when input-error recovery is exhausted', async () => {
		returnOcrExitCodes([2, 2]);
		await expect(
			runOcrMyPdf(job, 'eng', input, config.app.stage, directory),
		).resolves.toEqual({
			isSuccess: false,
			failureReason: 'INPUT_FILE',
			message: expect.stringContaining('diagnostic for 2'),
		});
		expect(ocrCalls()).toHaveLength(2);
	});

	it('returns an ordinary failure result for an unknown exit code', async () => {
		returnOcrExitCodes([42]);
		await expect(
			runOcrMyPdf(job, 'eng', input, config.app.stage, directory),
		).resolves.toEqual({
			isSuccess: false,
			failureReason: 'OTHER_ERROR',
			message: expect.stringContaining('code 42'),
		});
	});

	it('retries input errors once with skip-text', async () => {
		job.settings = { ocrLanguages: ['eng'], initialFlag: '--redo-ocr' };
		returnOcrExitCodes([2, 0]);
		await runOcrJob(job, input, directory, config, sqs, visibility);
		expect(ocrCalls().map((call) => call[2][0])).toEqual([
			'--redo-ocr',
			'--skip-text',
		]);
		expect(uploadToS3).toHaveBeenCalledTimes(1);
	});

	it('decrypts encrypted PDFs, retries with redo-ocr, and keeps the decrypted input when falling back to skip-text', async () => {
		job.settings = { ocrLanguages: ['eng'], initialFlag: '--force-ocr' };
		returnOcrExitCodes([8, 2, 0]);
		await runOcrJob(job, input, directory, config, sqs, visibility);
		const decrypted = path.join(directory, 'ocr', 'input.pdf.eng.decrypt.pdf');
		expect(runSpawnCommand).toHaveBeenCalledWith(
			'qpdf',
			'qpdf',
			['--decrypt', input, decrypted],
			false,
			false,
		);
		expect(ocrCalls().map((call) => call[2][0])).toEqual([
			'--force-ocr',
			'--redo-ocr',
			'--skip-text',
		]);
		expect(
			ocrCalls()
				.slice(1)
				.map((call) => call[2][call[2].length - 2]),
		).toEqual([decrypted, decrypted]);
	});

	it('does not loop when input and encryption errors alternate', async () => {
		job.settings.ocrLanguages = ['eng'];
		returnOcrExitCodes([2, 8, 2, 8]);
		const result = await runOcrJob(
			job,
			input,
			directory,
			config,
			sqs,
			visibility,
			attributes,
		);
		expect(ocrCalls()).toHaveLength(3);
		expect(result).toEqual({
			isSuccess: false,
			failureReason: 'INPUT_FILE',
			message: expect.stringContaining('code 2'),
		});
		expect(publishTranscriptionOutput).not.toHaveBeenCalled();
	});

	it('reports encrypted PDF failure when qpdf cannot decrypt it', async () => {
		job.settings.ocrLanguages = ['eng'];
		returnOcrExitCodes([8]);
		const implementation = jest
			.mocked(runSpawnCommand)
			.getMockImplementation()!;
		jest.mocked(runSpawnCommand).mockImplementation(async (...args) => {
			if (args[0] !== 'qpdf') return implementation(...args);
			const result = { code: 2, stdout: '', stderr: 'invalid password' };
			// Match the real runner: nonzero exits reject unless explicitly allowed.
			if (args[4] ?? true) throw result;
			return result;
		});
		const result = await runOcrJob(
			job,
			input,
			directory,
			config,
			sqs,
			visibility,
		);
		expect(result).toEqual({
			isSuccess: false,
			failureReason: 'ENCRYPTED_PDF',
			message: expect.stringContaining('invalid password'),
		});
		expect(publishTranscriptionOutput).not.toHaveBeenCalled();
		expect(ocrCalls()).toHaveLength(1);
	});

	it.each(['stdout', 'stderr'] as const)(
		'checks colour conversion once and reuses the %s result across retries',
		async (stream) => {
			job.settings.ocrLanguages = ['eng'];
			returnOcrExitCodes([8, 2, 0]);
			const implementation = jest
				.mocked(runSpawnCommand)
				.getMockImplementation()!;
			jest.mocked(runSpawnCommand).mockImplementation(async (...args) =>
				args[2].includes('/dev/null')
					? {
							code: 10,
							stdout: '',
							stderr: '',
							[stream]: 'ColorConversionNeededError: colour profile',
						}
					: implementation(...args),
			);
			await runOcrJob(job, input, directory, config, sqs, visibility);
			expect(
				jest
					.mocked(runSpawnCommand)
					.mock.calls.filter(([, , args]) => args.includes('/dev/null')),
			).toHaveLength(1);
			expect(ocrCalls()).toHaveLength(3);
			for (const call of ocrCalls()) {
				expect(call[2]).toContain('--color-conversion-strategy=RGB');
			}
		},
	);

	it.each([4, 10])(
		'accepts exit code %s when a PDF is produced',
		async (code) => {
			job.settings.ocrLanguages = ['eng'];
			returnOcrExitCodes([code]);
			await runOcrJob(job, input, directory, config, sqs, visibility);
			expect(publishTranscriptionOutput).toHaveBeenCalledWith(
				sqs,
				'output-queue',
				expect.objectContaining({ status: 'OCR_SUCCESS' }),
				undefined,
			);
		},
	);

	it.each([
		[1, 'BAD_ARGS'],
		[2, 'INPUT_FILE'],
		[3, 'MISSING_DEPENDENCY'],
		[5, 'FILE_ACCESS_ERROR'],
		[6, 'ALREADY_DONE_OCR'],
		[7, 'CHILD_PROCESS_ERROR'],
		[8, 'ENCRYPTED_PDF'],
		[9, 'INVALID_CONFIG'],
		[15, 'OTHER_ERROR'],
		[42, 'OTHER_ERROR'],
	])(
		'returns exit code %s as %s for the caller to report',
		async (code, failureReason) => {
			job.settings.ocrLanguages = ['eng'];
			returnOcrExitCodes([Number(code), Number(code)]);
			const result = await runOcrJob(
				job,
				input,
				directory,
				config,
				sqs,
				visibility,
				attributes,
			);
			expect(result).toEqual({
				isSuccess: false,
				failureReason,
				message: expect.stringContaining(`diagnostic for ${code}`),
			});
			expect(publishTranscriptionOutput).not.toHaveBeenCalled();
			expect(uploadToS3).not.toHaveBeenCalled();
			expect(fs.readdirSync(directory)).toEqual(['input.pdf']);
		},
	);

	it('reports OTHER_ERROR when OCR returns no exit code', async () => {
		const implementation = jest
			.mocked(runSpawnCommand)
			.getMockImplementation()!;
		jest
			.mocked(runSpawnCommand)
			.mockImplementation(async (...args) =>
				args[0] === 'ocrmypdf' && args[2].includes('--plugin')
					? { code: undefined, stdout: '', stderr: '' }
					: implementation(...args),
			);
		const result = await runOcrJob(
			job,
			input,
			directory,
			config,
			sqs,
			visibility,
		);
		expect(result).toEqual({
			isSuccess: false,
			failureReason: 'OTHER_ERROR',
			message: 'Failed to get exit code from ocrmypdf',
		});
		expect(publishTranscriptionOutput).not.toHaveBeenCalled();
		expect(uploadToS3).not.toHaveBeenCalled();
		expect(fs.readdirSync(directory)).toEqual(['input.pdf']);
	});

	it('discards successful languages when a later language has a terminal failure', async () => {
		returnOcrExitCodes([0, 3]);
		const result = await runOcrJob(
			job,
			input,
			directory,
			config,
			sqs,
			visibility,
		);
		expect(ocrCalls()).toHaveLength(2);
		expect(uploadToS3).not.toHaveBeenCalled();
		expect(publishTranscriptionOutput).not.toHaveBeenCalled();
		expect(result).toEqual({
			isSuccess: false,
			failureReason: 'MISSING_DEPENDENCY',
			message: expect.stringContaining('fra'),
		});
		expect(fs.readdirSync(directory)).toEqual(['input.pdf']);
	});

	it('uses the file-size visibility estimate when pdfinfo fails on an encrypted PDF', async () => {
		job.settings.ocrLanguages = ['eng'];
		returnOcrExitCodes([8, 0]);
		const implementation = jest
			.mocked(runSpawnCommand)
			.getMockImplementation()!;
		jest
			.mocked(runSpawnCommand)
			.mockImplementation(async (...args) =>
				args[0] === 'pdfinfo'
					? { code: 1, stdout: '', stderr: 'encrypted' }
					: implementation(...args),
			);
		await runOcrJob(job, input, directory, config, sqs, visibility);
		expect(visibility).toHaveBeenCalledWith(120);
	});

	it('propagates success-notification errors to the caller', async () => {
		jest
			.mocked(publishTranscriptionOutput)
			.mockRejectedValue(new Error('SQS unavailable'));
		await expect(
			runOcrJob(job, input, directory, config, sqs, visibility),
		).rejects.toThrow('SQS unavailable');
		expect(uploadToS3).toHaveBeenCalledTimes(1);
		expect(fs.readdirSync(directory)).toEqual(['input.pdf']);
	});

	it('builds a schema-valid failure output with the job identity and error details', () => {
		const output = ocrFailureOutput(job, {
			isSuccess: false,
			failureReason: 'INPUT_FILE',
			message: 'Invalid input PDF',
		});
		expect(OcrOutputFailure.parse(output)).toEqual({
			id: job.id,
			userEmail: job.userEmail,
			status: 'OCR_FAILURE',
			failureReason: 'INPUT_FILE',
			message: 'Invalid input PDF',
		});
	});

	it('rejects jobs without any OCR languages', () => {
		expect(
			OcrJob.safeParse({ ...job, settings: { ocrLanguages: [] } }).success,
		).toBe(false);
	});
});
