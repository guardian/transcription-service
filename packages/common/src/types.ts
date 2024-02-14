import { z } from 'zod';

export enum DestinationService {
	TranscriptionService = 'TranscriptionService',
}

const OutputSignedUrl = z.object({
	url: z.string(),
	key: z.string(),
});

export type OutputSignedUrl = z.infer<typeof OutputSignedUrl>;

const OutputBucketUrls = z.object({
	srt: OutputSignedUrl,
	text: OutputSignedUrl,
	json: OutputSignedUrl,
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
	s3Key: z.string(),
	retryCount: z.number(),
	sentTimestamp: z.string(),
	userEmail: z.string(),
	transcriptDestinationService: z.nativeEnum(DestinationService),
	outputBucketUrls: OutputBucketUrls,
});

export type TranscriptionJob = z.infer<typeof TranscriptionJob>;

export const TranscriptionOutput = z.object({
	id: z.string(),
	originalFilename: z.string(),
	languageCode: z.string(),
	// englishTranslation: z.optional(z.string()),
	userEmail: z.string(),
	outputBucketKeys: OutputBucketKeys,
});

export type TranscriptionOutput = z.infer<typeof TranscriptionOutput>;

export const SignedUrlQueryParams = z.object({ fileName: z.string() });

export const SignedUrlResponseBody = z.object({
	presignedS3Url: z.string(),
});
export type SignedUrlResponseBody = z.infer<typeof SignedUrlResponseBody>;
