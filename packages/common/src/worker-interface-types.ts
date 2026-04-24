// types used by external services (e.g. Giant) to interact with the
// transcription service
import { z } from 'zod';
import { inputLanguageCodes } from './languages';

export const TranscriptionEngine = z.enum(['whisperx']);
export type TranscriptionEngine = z.infer<typeof TranscriptionEngine>;

export const DestinationService = z.enum(['TranscriptionService', 'Giant']);
export type DestinationService = z.infer<typeof DestinationService>;

export const LlmBackend = z.enum(['LOCAL', 'BEDROCK']);
export type LlmBackend = z.infer<typeof LlmBackend>;

export const InputLanguageCode = z.enum(inputLanguageCodes);
export type InputLanguageCode = z.infer<typeof InputLanguageCode>;

const SignedUrl = z.object({
	url: z.string(),
	key: z.string(),
});
export type SignedUrl = z.infer<typeof SignedUrl>;

export const JobType = z.enum(['transcribe', 'llm']);
export type JobType = z.infer<typeof JobType>;

export const Job = z.object({
	id: z.string(),
	originalFilename: z.string(),
	inputSignedUrl: z.string(),
	sentTimestamp: z.string(),
	userEmail: z.string(),
	transcriptDestinationService: DestinationService,
	combinedOutputUrl: SignedUrl,
	jobType: JobType,
});
export type Job = z.infer<typeof Job>;

export const TranscriptionJob = Job.extend({
	jobType: z.literal('transcribe'),
	languageCode: InputLanguageCode,
	translate: z.boolean(),
	diarize: z.boolean(),
	engine: TranscriptionEngine,
});
export type TranscriptionJob = z.infer<typeof TranscriptionJob>;

export const LLMJob = Job.extend({
	jobType: z.literal('llm'),
	backend: LlmBackend,
});
export type LLMJob = z.infer<typeof LLMJob>;

export const WorkerJob = z.discriminatedUnion('jobType', [
	LLMJob,
	TranscriptionJob,
]);

export type WorkerJob = z.infer<typeof WorkerJob>;
