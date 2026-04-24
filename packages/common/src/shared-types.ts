// types used by external services (e.g. Giant) to interact with the
// transcription service
import { z } from 'zod';
import { InputLanguageCode } from './types';

export enum TranscriptionEngine {
	WHISPER_X = 'whisperx',
	WHISPER_CPP = 'whispercpp',
}
const SignedUrl = z.object({
	url: z.string(),
	key: z.string(),
});
export type SignedUrl = z.infer<typeof SignedUrl>;

export const JobType = z.enum(['transcribe', 'llm']);
export type JobType = z.infer<typeof JobType>;

export enum DestinationService {
	TranscriptionService = 'TranscriptionService',
	Giant = 'Giant',
}

export const Job = z.object({
	id: z.string(),
	originalFilename: z.string(),
	inputSignedUrl: z.string(),
	sentTimestamp: z.string(),
	userEmail: z.string(),
	transcriptDestinationService: z.nativeEnum(DestinationService),
	combinedOutputUrl: SignedUrl,
});
export type Job = z.infer<typeof Job>;

export const TranscriptionJob = Job.extend({
	jobType: z.literal('transcribe').optional(),
	languageCode: InputLanguageCode,
	translate: z.boolean(),
	diarize: z.boolean(),
	engine: z.nativeEnum(TranscriptionEngine),
});
export type TranscriptionJob = z.infer<typeof TranscriptionJob>;

export const LlmBackend = z.union([z.literal('LOCAL'), z.literal('BEDROCK')]);
export type LlmBackend = z.infer<typeof LlmBackend>;

export const LLMJob = Job.extend({
	jobType: z.literal('llm'),
	backend: LlmBackend,
});
export type LLMJob = z.infer<typeof LLMJob>;

export const WorkerJob = z.union([LLMJob, TranscriptionJob]);

export type WorkerJob = z.infer<typeof WorkerJob>;
