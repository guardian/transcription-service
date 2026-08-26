import * as z from 'zod';

import {
	InputLanguageCode,
	Job,
	JobType,
	LLMJob,
	LLMOutputFailure,
	LLMOutputSuccess,
	LLMTranslationJob,
	LlmBackend,
	LlmPrompt,
	OutputBase,
	OutputLanguageCode,
	TranscriptionEngine,
	TranscriptionJob,
	TranscriptionMetadata,
	TranscriptionOutputFailure,
	TranscriptionOutputSuccess,
	TranscriptionResult,
	Transcripts,
	TranslationField,
	TranslationTask,
	WorkerJob,
} from './worker-interface-types';

const JSON_SCHEMA_TARGET = 'draft-2020-12' as const;
const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

// big shared const so that the schema generation and test for schema generation can use the same set of types
export const workerInterfaceSchemas = {
	OutputLanguageCode,
	Transcripts,
	TranscriptionMetadata,
	TranscriptionEngine,
	LlmBackend,
	InputLanguageCode,
	JobType,
	Job,
	TranscriptionJob,
	LLMJob,
	LLMTranslationJob,
	WorkerJob,
	LlmPrompt,
	TranslationField,
	TranslationTask,
	OutputBase,
	TranscriptionOutputSuccess,
	TranscriptionOutputFailure,
	LLMOutputSuccess,
	LLMOutputFailure,
	TranscriptionResult,
};

export const workerInterfaceSchemaNames = Object.keys(workerInterfaceSchemas);

export const WorkerInterfaceTypes = z.object(workerInterfaceSchemas);

/**
 * Give each named schema an `id` so that zod emits it once under `$defs` and
 * references it via `$ref` everywhere it is used, rather than inlining a copy.
 * Without this the (very long) language code enums are repeated for every type
 * that uses them, which makes the generated schema file enormous.
 */
const registerSchemaIds = () => {
	for (const [name, schema] of Object.entries(workerInterfaceSchemas)) {
		z.globalRegistry.add(schema as z.ZodType, { id: name });
	}
};

/** Generates the JSON Schema document for all worker interface types. */
export const buildWorkerInterfaceJsonSchema = (): Record<string, unknown> => {
	registerSchemaIds();
	return {
		$schema: JSON_SCHEMA_DIALECT,
		...z.toJSONSchema(WorkerInterfaceTypes, { target: JSON_SCHEMA_TARGET }),
	};
};
