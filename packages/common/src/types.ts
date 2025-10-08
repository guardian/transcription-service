import { z } from 'zod';
import { inputLanguageCodes, outputLanguageCodes } from './languages';

export const InputLanguageCode = z.enum(inputLanguageCodes);
export type InputLanguageCode = z.infer<typeof InputLanguageCode>;

export const OutputLanguageCode = z.enum(outputLanguageCodes);
export type OutputLanguageCode = z.infer<typeof OutputLanguageCode>;

export const inputToOutputLanguageCode = (
	c: InputLanguageCode,
): OutputLanguageCode => (c === 'auto' ? 'UNKNOWN' : c);

export enum DestinationService {
	TranscriptionService = 'TranscriptionService',
	Giant = 'Giant',
}

const SignedUrl = z.object({
	url: z.string(),
	key: z.string(),
});

export type SignedUrl = z.infer<typeof SignedUrl>;

const OutputBucketUrls = z.object({
	srt: SignedUrl,
	text: SignedUrl,
	json: SignedUrl,
});

export type OutputBucketUrls = z.infer<typeof OutputBucketUrls>;

const OutputBucketKeys = z.object({
	srt: z.string(),
	text: z.string(),
	json: z.string(),
});

export type OutputBucketKeys = z.infer<typeof OutputBucketKeys>;

const UrlJob = z.object({
	id: z.string(),
	url: z.string(),
	client: z.string(),
});

export type MediaDownloadJob = z.infer<typeof UrlJob>;

export const TranscriptionMediaDownloadJob = UrlJob.extend({
	client: z.literal('TRANSCRIPTION_SERVICE'),
	userEmail: z.string(),
	languageCode: InputLanguageCode,
	translationRequested: z.boolean(),
	diarizationRequested: z.boolean(),
});
export type TranscriptionMediaDownloadJob = z.infer<
	typeof TranscriptionMediaDownloadJob
>;

export const ExternalUrlJob = UrlJob.extend({
	client: z.literal('EXTERNAL'),
	outputQueueUrl: z.string(),
	s3OutputSignedUrl: z.string(),
});
export type ExternalUrlJob = z.infer<typeof ExternalUrlJob>;

export const isTranscriptionMediaDownloadJob = (
	job: MediaDownloadJob,
): job is TranscriptionMediaDownloadJob =>
	job.client === 'TRANSCRIPTION_SERVICE';

export const isExternalMediaDownloadJob = (
	job: MediaDownloadJob,
): job is ExternalUrlJob => job.client === 'EXTERNAL';

export const MediaMetadata = z.object({
	title: z.string(),
	extension: z.string(),
	mediaPath: z.string(),
	duration: z.number(),
});
export type MediaMetadata = z.infer<typeof MediaMetadata>;

export const ExternalMediaDownloadJobOutput = z.object({
	id: z.string(),
	status: z.union([z.literal('SUCCESS'), z.literal('FAILURE')]),
	metadata: z.optional(MediaMetadata),
});

export type ExternalMediaDownloadJobOutput = z.infer<
	typeof ExternalMediaDownloadJobOutput
>;

export enum TranscriptionEngine {
	WHISPER_X = 'whisperx',
	WHISPER_CPP = 'whispercpp',
}

export const TranscriptionJob = z.object({
	id: z.string(),
	originalFilename: z.string(),
	inputSignedUrl: z.string(),
	sentTimestamp: z.string(),
	userEmail: z.string(),
	transcriptDestinationService: z.nativeEnum(DestinationService),
	combinedOutputUrl: SignedUrl,
	languageCode: InputLanguageCode,
	translate: z.boolean(),
	diarize: z.boolean(),
	engine: z.nativeEnum(TranscriptionEngine),
});

export type TranscriptionJob = z.infer<typeof TranscriptionJob>;

const OutputBase = z.object({
	id: z.string(),
	userEmail: z.string(),
});

const TranscriptionOutputBase = OutputBase.extend({
	originalFilename: z.string(),
	isTranslation: z.boolean(),
});

export const TranscriptionOutputSuccess = TranscriptionOutputBase.extend({
	// status must be kept in sync with https://github.com/guardian/giant/blob/main/backend/app/extraction/ExternalTranscriptionExtractor.scala#L76
	status: z.literal('SUCCESS'),
	languageCode: OutputLanguageCode,
	combinedOutputKey: z.string(),
	duration: z.optional(z.number()),
});

export const MediaDownloadFailure = OutputBase.extend({
	// status must be kept in sync with https://github.com/guardian/giant/blob/main/backend/app/extraction/ExternalTranscriptionExtractor.scala#L76
	status: z.literal('MEDIA_DOWNLOAD_FAILURE'),
	url: z.string(),
});

export type MediaDownloadFailure = z.infer<typeof MediaDownloadFailure>;

export const TranscriptionOutputFailure = TranscriptionOutputBase.extend({
	// status must be kept in sync with https://github.com/guardian/giant/blob/main/backend/app/extraction/ExternalTranscriptionExtractor.scala#L76
	status: z.literal('TRANSCRIPTION_FAILURE'),
});

export const TranscriptionOutput = z.union([
	TranscriptionOutputSuccess,
	TranscriptionOutputFailure,
	MediaDownloadFailure,
]);

export type TranscriptionOutputSuccess = z.infer<
	typeof TranscriptionOutputSuccess
>;

export type TranscriptionOutputFailure = z.infer<
	typeof TranscriptionOutputFailure
>;

export const transcriptionOutputIsSuccess = (
	output: TranscriptionOutput,
): output is TranscriptionOutputSuccess => output.status === 'SUCCESS';

export const transcriptionOutputIsTranscriptionFailure = (
	output: TranscriptionOutput,
): output is TranscriptionOutputFailure =>
	output.status === 'TRANSCRIPTION_FAILURE';

export const transcriptionOutputIsMediaDownloadFailure = (
	output: TranscriptionOutput,
): output is MediaDownloadFailure => output.status === 'MEDIA_DOWNLOAD_FAILURE';

export type TranscriptionOutput = z.infer<typeof TranscriptionOutput>;

export const SignedUrlResponseBody = z.object({
	presignedS3Url: z.string(),
	s3Key: z.string(),
});
export type SignedUrlResponseBody = z.infer<typeof SignedUrlResponseBody>;

export const ClientConfig = z.object({
	googleClientId: z.string(),
});

export type ClientConfig = z.infer<typeof ClientConfig>;

// this type is Zod version of the TokenResponse interface in the google oauth2 library - to understand what the
// different properties mean check that library. We duplicate it here just to get nice zod parsing
// I was hoping we could at least get the typechecker to tell us if we missed a property or use the wrong type for
// a property of TokenResponse by setting the type as z.ZodType<google.accounts.oauth2.TokenResponse> - but it looks like
// the returned TokenResponse doesn't actually respect the TokenResponse type
export const ZTokenResponse = z.object({
	access_token: z.string(),
	expires_in: z.number(),
	hd: z.string(),
	prompt: z.string(),
	token_type: z.string(),
	scope: z.string(),
	state: z.optional(z.string()),
	error: z.optional(z.string()),
	error_description: z.optional(z.string()),
	error_uri: z.optional(z.string()),
});

export type ZTokenResponse = z.infer<typeof ZTokenResponse>;

const ExportType = z.union([
	z.literal('text'),
	z.literal('srt'),
	z.literal('source-media'),
]);
export type ExportType = z.infer<typeof ExportType>;

export const ExportItems = z.array(ExportType);

export type ExportItems = z.infer<typeof ExportItems>;

const ExportSuccess = z.object({
	status: z.literal('success'),
	exportType: ExportType,
	id: z.string(),
});

const ExportFailure = z.object({
	status: z.literal('failure'),
	exportType: ExportType,
	message: z.string(),
});

const ExportInProgress = z.object({
	status: z.literal('in-progress'),
	exportType: ExportType,
});

export const ExportStatus = z.discriminatedUnion('status', [
	ExportSuccess,
	ExportFailure,
	ExportInProgress,
]);
export type ExportStatus = z.infer<typeof ExportStatus>;

export const ExportStatuses = z.array(ExportStatus);
export type ExportStatuses = z.infer<typeof ExportStatuses>;

export const TranscriptIdentifier = z.object({
	id: z.string(),
});

export type TranscriptIdentifier = z.infer<typeof TranscriptIdentifier>;

export const TranscriptDownloadRequest = z.object({
	id: z.string(),
	format: z.union([z.literal('text'), z.literal('srt')]),
});
export type TranscriptDownloadRequest = z.infer<
	typeof TranscriptDownloadRequest
>;

export const TranscriptExportRequest = z.object({
	id: z.string(),
	oAuthTokenResponse: ZTokenResponse,
	items: ExportItems,
	folderId: z.string(),
});

export type TranscriptExportRequest = z.infer<typeof TranscriptExportRequest>;

export const CreateFolderRequest = z.object({
	transcriptId: z.string(),
	oAuthTokenResponse: ZTokenResponse,
});

export type CreateFolderRequest = z.infer<typeof CreateFolderRequest>;

export const transcribeUrlRequestBody = z.object({
	url: z.string(),
	languageCode: InputLanguageCode,
	translationRequested: z.boolean(),
	diarizationRequested: z.boolean(),
});

export type TranscribeUrlRequestBody = z.infer<typeof transcribeUrlRequestBody>;

export const transcribeFileRequestBody = z.object({
	s3Key: z.string(),
	fileName: z.string(),
	languageCode: InputLanguageCode,
	translationRequested: z.boolean(),
	diarizationRequested: z.boolean(),
});
export type TranscribeFileRequestBody = z.infer<
	typeof transcribeFileRequestBody
>;

export const signedUrlRequestBody = z.object({
	fileName: z.string(),
});

export type SignedUrlRequestBody = z.infer<typeof signedUrlRequestBody>;

export const inputBucketObjectMetadata = z.object({
	'user-email': z.string(),
});
export type InputBucketObjectMetadata = z.infer<
	typeof inputBucketObjectMetadata
>;

export type MediaSourceType = 'file' | 'url';

export const TranscriptionDynamoItem = z.object({
	id: z.string(),
	originalFilename: z.string(),
	combinedOutputKey: z.string(),
	userEmail: z.string(),
	completedAt: z.optional(z.string()), // dynamodb can't handle dates so we need to use an ISO date
	isTranslation: z.boolean(),
	languageCode: z.optional(OutputLanguageCode),
	exportStatuses: z.optional(ExportStatuses),
});

export type TranscriptionDynamoItem = z.infer<typeof TranscriptionDynamoItem>;

export const Transcripts = z.object({
	srt: z.string(),
	text: z.string(),
	json: z.string(),
});
export type Transcripts = z.infer<typeof Transcripts>;

export const TranscriptionMetadata = z.object({
	detectedLanguageCode: OutputLanguageCode,
	loadTimeMs: z.optional(z.number()),
	totalTimeMs: z.optional(z.number()),
});
export type TranscriptionMetadata = z.infer<typeof TranscriptionMetadata>;

export const TranscriptionResult = z.object({
	transcripts: Transcripts,
	transcriptTranslations: z.optional(Transcripts),
	metadata: TranscriptionMetadata,
});
export type TranscriptionResult = z.infer<typeof TranscriptionResult>;

export const TranscriptionItemWithTranscript = z.object({
	item: TranscriptionDynamoItem,
	transcript: TranscriptionResult,
});
export type TranscriptionItemWithTranscript = z.infer<
	typeof TranscriptionItemWithTranscript
>;
