import { z } from 'zod';
import { languageCodeToLanguage } from './languages';

// thanks https://github.com/colinhacks/zod/discussions/2125#discussioncomment-7452235
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getKeys<T extends Record<string, any>>(obj: T) {
	return Object.keys(obj) as [keyof typeof obj];
}

const zodLanguageCode = z.enum(getKeys(languageCodeToLanguage));

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

export const MediaDownloadJob = z.object({
	id: z.string(),
	url: z.string(),
	userEmail: z.string(),
	languageCode: zodLanguageCode,
	translationRequested: z.boolean(),
});

export type MediaDownloadJob = z.infer<typeof MediaDownloadJob>;

export const TranscriptionJob = z.object({
	id: z.string(),
	originalFilename: z.string(),
	inputSignedUrl: z.string(),
	sentTimestamp: z.string(),
	userEmail: z.string(),
	transcriptDestinationService: z.nativeEnum(DestinationService),
	outputBucketUrls: OutputBucketUrls,
	languageCode: zodLanguageCode,
	translate: z.boolean(),
	// we can get rid of this when we switch to using a zip
	translationOutputBucketUrls: z.optional(OutputBucketUrls),
});

export type TranscriptionJob = z.infer<typeof TranscriptionJob>;

const TranscriptionOutputBase = z.object({
	id: z.string(),
	originalFilename: z.string(),
	userEmail: z.string(),
	isTranslation: z.boolean(),
});

export const TranscriptionOutputSuccess = TranscriptionOutputBase.extend({
	status: z.literal('SUCCESS'),
	languageCode: z.string(),
	outputBucketKeys: OutputBucketKeys,
	// we can get rid of this when we switch to using a zip
	translationOutputBucketKeys: z.optional(OutputBucketKeys),
});

export const MediaDownloadFailure = z.object({
	id: z.string(),
	status: z.literal('MEDIA_DOWNLOAD_FAILURE'),
	url: z.string(),
});

export type MediaDownloadFailure = z.infer<typeof MediaDownloadFailure>;

export const TranscriptionOutputFailure = TranscriptionOutputBase.extend({
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
): output is TranscriptionOutputSuccess =>
	output.status === 'TRANSCRIPTION_FAILURE';

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

export const ExportStatuses = z.array(ExportStatus);
export type ExportStatuses = z.infer<typeof ExportStatuses>;

export type ExportStatus = z.infer<typeof ExportStatus>;

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
	languageCode: zodLanguageCode,
	translationRequested: z.boolean(),
});

export type TranscribeUrlRequestBody = z.infer<typeof transcribeUrlRequestBody>;

export const transcribeFileRequestBody = z.object({
	s3Key: z.string(),
	fileName: z.string(),
	languageCode: zodLanguageCode,
	translationRequested: z.boolean(),
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
