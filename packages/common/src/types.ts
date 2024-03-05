import { z } from 'zod';

export enum DestinationService {
	TranscriptionService = 'TranscriptionService',
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

export const TranscriptionJob = z.object({
	id: z.string(),
	originalFilename: z.string(),
	inputSignedUrl: z.string(),
	sentTimestamp: z.string(),
	userEmail: z.string(),
	transcriptDestinationService: z.nativeEnum(DestinationService),
	outputBucketUrls: OutputBucketUrls,
});

export type TranscriptionJob = z.infer<typeof TranscriptionJob>;

const TranscriptionOutputBase = z.object({
	id: z.string(),
	originalFilename: z.string(),
	userEmail: z.string(),
});

export const TranscriptionOutputSuccess = TranscriptionOutputBase.extend({
	status: z.literal('SUCCESS'),
	languageCode: z.string(),
	outputBucketKeys: OutputBucketKeys,
});

export const TranscriptionOutputFailure = TranscriptionOutputBase.extend({
	status: z.literal('FAILURE'),
});

export const TranscriptionOutput = z.union([
	TranscriptionOutputSuccess,
	TranscriptionOutputFailure,
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

export const TranscriptExportRequest = z.object({
	id: z.string(),
	oAuthTokenResponse: ZTokenResponse,
});

export type TranscriptExportRequest = z.infer<typeof TranscriptExportRequest>;

export const ExportResponse = z.object({
	documentId: z.string(),
});

export type ExportResponse = z.infer<typeof ExportResponse>;

export const transcribeFileRequestBody = z.object({
	s3Key: z.string(),
	fileName: z.string(),
});
export type TranscribeFileRequestBody = z.infer<
	typeof transcribeFileRequestBody
>;

export const inputBucketObjectMetadata = z.object({
	'user-email': z.string(),
});
export type InputBucketObjectMetadata = z.infer<
	typeof inputBucketObjectMetadata
>;
