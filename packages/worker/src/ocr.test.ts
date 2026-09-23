import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
	DestinationService,
	OcrJob,
	OcrOutput,
	uploadToS3,
} from '@guardian/transcription-service-common';
import {
	publishTranscriptionOutput,
	runSpawnCommand,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { processOcrJob } from './ocr';

jest.mock('@guardian/transcription-service-common', () => ({
	...jest.requireActual('@guardian/transcription-service-common'),
	uploadToS3: jest.fn(),
}));
jest.mock('@guardian/transcription-service-backend-common', () => ({
	logger: { info: jest.fn() },
	runSpawnCommand: jest.fn(),
	publishTranscriptionOutput: jest.fn(),
}));

const config = {
	app: { stage: 'DEV', destinationQueueUrls: { Giant: 'output-queue' } },
} as TranscriptionConfig;
const sqs = {} as SQSClient;
const attributes = {
	GiantExtractorName: {
		DataType: 'String',
		StringValue: 'ExternalOcrMyPdfExtractor',
	},
};

describe('processOcrJob', () => {
	let directory: string;
	let input: string;
	let job: OcrJob;
	const visibility = jest.fn();

	beforeEach(() => {
		jest.resetAllMocks();
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
			.mockImplementation(
				async (name, _command, args, _log, _reject, callback) => {
					if (name === 'pdfinfo') callback?.({ stdout: 'Pages: 10\n' });
					if (name === 'ocrmypdf') {
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
					return { stdout: '', stderr: '' };
				},
			);
	});

	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

	it('runs each language with the requested options and uploads language-tagged PDFs before publishing success', async () => {
		await processOcrJob(job, input, config, sqs, visibility, attributes);
		const calls = jest
			.mocked(runSpawnCommand)
			.mock.calls.filter(([name]) => name === 'ocrmypdf');
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
				`${input}.${i}.ocr.pdf`,
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
		expect(visibility.mock.calls).toEqual([[200], [100]]);
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
		await processOcrJob(job, input, config, sqs, visibility);
		expect(runSpawnCommand).toHaveBeenCalledWith(
			'pdfinfo',
			'pdfinfo',
			[input],
			false,
			true,
			expect.any(Function),
		);
		const args = jest
			.mocked(runSpawnCommand)
			.mock.calls.find(([name]) => name === 'ocrmypdf')![2];
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
			processOcrJob(job, input, config, sqs, visibility),
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
			processOcrJob(job, input, config, sqs, visibility),
		).rejects.toThrow('upload failed');
		expect(publishTranscriptionOutput).not.toHaveBeenCalled();
	});

	it('rejects jobs without any OCR languages', () => {
		expect(
			OcrJob.safeParse({ ...job, settings: { ocrLanguages: [] } }).success,
		).toBe(false);
	});
});
