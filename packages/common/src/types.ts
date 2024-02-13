import { z } from 'zod';

export enum DestinationService {
	TranscriptionService = 'TranscriptionService',
}

const OutputBucketUrls = z.object({
	srt: z.string(),
	text: z.string(),
	json: z.string(),
});

export type OutputBucketUrls = z.infer<typeof OutputBucketUrls>;

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
	outputBucketUrls: OutputBucketUrls,
});

export type TranscriptionOutput = z.infer<typeof TranscriptionOutput>;

export const SignedUrlQueryParams = z.object({ fileName: z.string() });

export const SignedUrlResponseBody = z.object({
	presignedS3Url: z.string(),
});
export type SignedUrlResponseBody = z.infer<typeof SignedUrlResponseBody>;
