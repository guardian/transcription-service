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
	TranscriptionOutput,
	MediaDownloadFailure,
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
	TranscriptionOutput,
	MediaDownloadFailure,
};

export const workerInterfaceSchemaNames = Object.keys(workerInterfaceSchemas);

export const WorkerInterfaceTypes = z.object(workerInterfaceSchemas);

/**
 * Register every named type in zod's global registry under its own `id`. Zod's
 * JSON Schema converter uses these ids to hoist each type into a shared
 * `$defs` map and emit `{ "$ref": "#/$defs/<TypeName>" }` wherever the type is
 * referenced, rather than inlining (and duplicating) the whole definition.
 */
const registerWorkerInterfaceSchemas = () => {
	Object.entries(workerInterfaceSchemas).forEach(([id, schema]) => {
		const existing = z.globalRegistry.get(schema);
		if (existing?.id !== id) {
			z.globalRegistry.add(schema, { ...existing, id });
		}
	});
};

/** Generates the JSON Schema document for all worker interface types. */
export const buildWorkerInterfaceJsonSchema = (): Record<string, unknown> => {
	registerWorkerInterfaceSchemas();
	return {
		$schema: JSON_SCHEMA_DIALECT,
		...z.toJSONSchema(WorkerInterfaceTypes, {
			target: JSON_SCHEMA_TARGET,
		}),
	};
};
