import { z } from 'zod';

export const TranscriptionJob = z.object({
	id: z.string(),
	s3Url: z.string(),
	retryCount: z.number(),
	sentTimestamp: z.string(),
});

export type TranscriptionJob = z.infer<typeof TranscriptionJob>;
