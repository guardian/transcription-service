// types used by external services (e.g. Giant) to interact with the
// transcription service
import { z } from 'zod';
import { inputLanguageCodes } from './languages';
import {
	OutputLanguageCode,
	TranscriptionMetadata,
	Transcripts,
} from './types';

export const TranscriptionEngine = z.enum(['whisperx']);
export type TranscriptionEngine = z.infer<typeof TranscriptionEngine>;

export const LlmBackend = z.enum(['LOCAL', 'BEDROCK']);
export type LlmBackend = z.infer<typeof LlmBackend>;

export const InputLanguageCode = z.enum(inputLanguageCodes);
export type InputLanguageCode = z.infer<typeof InputLanguageCode>;

export enum DestinationService {
	TranscriptionService = 'TranscriptionService',
	Giant = 'Giant',
}

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
	transcriptDestinationService: z.enum(DestinationService),
	combinedOutputUrl: SignedUrl,
	jobType: JobType,
	ingestion: z.optional(z.string()),
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

export const LlmPrompt = z.object({
	system: z.string().optional(),
	user: z.string(),
	assistant: z.string().optional(),
});

export type LlmPrompt = z.infer<typeof LlmPrompt>;

export const OutputBase = z.object({
	id: z.string(),
	userEmail: z.string(),
});

const TranscriptionOutputBase = OutputBase.extend({
	originalFilename: z.string(),
});

export const TranscriptionOutputSuccess = TranscriptionOutputBase.extend({
	// status must be kept in sync with https://github.com/guardian/giant/blob/main/backend/app/extraction/ExternalTranscriptionExtractor.scala#L76
	status: z.literal('SUCCESS'),
	languageCode: OutputLanguageCode,
	combinedOutputKey: z.string(),
	duration: z.optional(z.number()),
	maybeEnqueuedAtEpochMillis: z.optional(z.number()),
	includesTranslation: z.boolean(),
	translationRequested: z.boolean(),
});

export const LLMOutputSuccess = OutputBase.extend({
	status: z.literal('LLM_SUCCESS'),
	outputKey: z.string(),
});
export type LLMOutputSuccess = z.infer<typeof LLMOutputSuccess>;

export const LLMOutputFailure = OutputBase.extend({
	status: z.literal('LLM_FAILURE'),
});
export type LLMOutputFailure = z.infer<typeof LLMOutputFailure>;

export const TranscriptionOutputFailure = TranscriptionOutputBase.extend({
	// status must be kept in sync with https://github.com/guardian/giant/blob/main/backend/app/extraction/ExternalTranscriptionExtractor.scala#L76
	status: z.literal('TRANSCRIPTION_FAILURE'),
	noAudioDetected: z.boolean(),
});

export const TranscriptionResult = z.object({
	transcripts: Transcripts,
	transcriptTranslations: z.optional(Transcripts),
	metadata: TranscriptionMetadata,
});
export type TranscriptionResult = z.infer<typeof TranscriptionResult>;

export type TranscriptionOutputSuccess = z.infer<
	typeof TranscriptionOutputSuccess
>;

export type TranscriptionOutputFailure = z.infer<
	typeof TranscriptionOutputFailure
>;
