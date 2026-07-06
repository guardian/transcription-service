import { sendPromptToBedrock } from '@guardian/transcription-service-backend-common/src/llm';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getEncoding } from 'js-tiktoken';
import { maskUrlsAndEmails, restoreMaskedItems } from './token-reduction';
import {
	LlmBackend,
	LlmPrompt,
} from '@guardian/transcription-service-common/src/worker-interface-types';
import { TranscriptionConfig } from '@guardian/transcription-service-backend-common/src/config';
import { logger } from '@guardian/transcription-service-backend-common';
import {
	MetricsService,
	llmTokensPerSecondMetric,
	secondsForLlmJobMetric,
} from '@guardian/transcription-service-backend-common/src/metrics';
import { LLAMA_SERVER_URL, sendPromptToLlamaServer } from './llama-server';

// To begin with we limit each request to roughly this many tokens of source text. The system prompt and
// the small fragment note we add are extra, but the model's context window has headroom for them.
export const MAX_INPUT_TOKENS_PER_CHUNK = 3000;

// For setting sqs visibility timeout - allow 10 minutes per chunk (based off basic testing of 2 jobs)
export const SECONDS_PER_CHUNK = 60 * 10;

export const PARALLEL_JOBS = 4;

// Both backends use Qwen models which share a tokenizer close to cl100k_base.
const enc = getEncoding('cl100k_base');
export const estimateTokens = (text: string): number => enc.encode(text).length;

// Splits text into chunks of at most MAX_INPUT_TOKENS_PER_CHUNK tokens, preferring to break on
// paragraph, sentence, or word boundaries across all supported scripts.
const textSplitter = new RecursiveCharacterTextSplitter({
	chunkSize: MAX_INPUT_TOKENS_PER_CHUNK,
	chunkOverlap: 0, // having overlap adds complexity so let's try manage without for now
	lengthFunction: estimateTokens,
	separators: [
		'\n\n', // paragraph breaks
		'\n', // line breaks
		'。',
		'！',
		'？', // CJK sentence terminators
		'؟', // Arabic question mark
		'…', // ellipsis
		'. ',
		'! ',
		'? ', // Latin sentence terminators (with trailing space to keep punctuation attached)
		' ', // word boundaries
		'', // character-level fallback
	],
});

//
const CHUNKING_NOTE =
	'This text is one part of a larger document that has been split for translation. ' +
	'Translate only this fragment; do not add introductions, conclusions or notes, ' +
	'and do not attempt to complete sentences that are cut off at the boundaries.';

const addChunkingNote = (systemPrompt: string | undefined): string =>
	[systemPrompt?.trim(), CHUNKING_NOTE].filter(Boolean).join('\n\n');

// Masks token-expensive URLs/emails then splits a large user prompt into chunks of at most
// MAX_INPUT_TOKENS_PER_CHUNK tokens. A single-chunk document is sent unchanged; multi-chunk
// documents have each fragment flagged with the chunking note. The maskLookup is returned so
// callers can restore the masked items after the model has processed the prompt.
export const splitPromptIntoChunks = async (
	prompt: LlmPrompt,
): Promise<{ prompts: LlmPrompt[]; maskLookup: Record<string, string> }> => {
	const { maskedText, maskLookup } = maskUrlsAndEmails(prompt.user);

	const chunks = await textSplitter.splitText(maskedText);

	const prompts: LlmPrompt[] =
		chunks.length <= 1
			? [{ system: prompt.system, user: maskedText }]
			: chunks.map((user) => ({
					system: addChunkingNote(prompt.system),
					user,
				}));

	return { prompts, maskLookup };
};

const runAndCombinePrompts = async (
	prompts: LlmPrompt[],
	runPrompt: (prompt: LlmPrompt) => Promise<string>,
): Promise<string> => {
	const outputs: string[] = new Array<string>(prompts.length);
	let nextIndex = 0;

	// Each worker pulls the next unprocessed prompt until none remain, keeping up to
	// PARALLEL_JOBS prompts in flight at all times. Note this only works because
	// javascript is single threaded, so we won't get multiple workers updating nextIndex at the same time.
	const worker = async () => {
		// store current index and update in one go
		let index = nextIndex++;
		while (index < prompts.length) {
			logger.info(`Running prompt ${index + 1} of ${prompts.length}`);
			outputs[index] = await runPrompt(prompts[index]!);
			index = nextIndex++;
		}
	};

	const workerCount = Math.min(PARALLEL_JOBS, prompts.length);
	await Promise.all(Array.from({ length: workerCount }, worker));

	return outputs.join('');
};

export const executeLlmPrompt = async (
	prompt: LlmPrompt,
	config: TranscriptionConfig,
	backend: LlmBackend,
	setMessageVisibility: (visibilityTimeoutSeconds: number) => Promise<void>,
	metrics: MetricsService,
): Promise<string> => {
	const { prompts, maskLookup } = await splitPromptIntoChunks(prompt);

	const visibilityTimeout = prompts.length * SECONDS_PER_CHUNK;
	logger.info(
		`Executing LLM prompt on ${backend} backend: ${estimateTokens(prompt.user)} estimated input tokens split into ${prompts.length} chunk(s), setting visibility timeout to ${visibilityTimeout}s`,
	);
	await setMessageVisibility(visibilityTimeout);

	const sendPrompt = async (chunkPrompt: LlmPrompt) => {
		if (backend === 'BEDROCK') {
			return sendPromptToBedrock(chunkPrompt, config.bedrock.modelId);
		} else {
			return sendPromptToLlamaServer(LLAMA_SERVER_URL, chunkPrompt);
		}
	};

	const startTime = Date.now();
	const combined = await runAndCombinePrompts(prompts, (chunkPrompt) =>
		sendPrompt(chunkPrompt),
	);
	const result = restoreMaskedItems(combined, maskLookup);

	const durationSeconds = (Date.now() - startTime) / 1000;
	const outputTokens = estimateTokens(result);
	const tokensPerSecond =
		durationSeconds > 0 ? outputTokens / durationSeconds : 0;

	logger.info(
		`LLM prompt completed in ${durationSeconds.toFixed(1)}s (${outputTokens} output tokens, ${tokensPerSecond.toFixed(1)} tokens/s, backend: ${backend})`,
		{
			llmPromptTimeSeconds: durationSeconds,
			llmOutputTokens: outputTokens,
			llmTokensPerSecond: tokensPerSecond,
			llmBackend: backend,
		},
	);

	const backendDimension = { Name: 'Backend', Value: backend };
	await Promise.all([
		metrics.putMetric(secondsForLlmJobMetric(durationSeconds), [
			backendDimension,
		]),
		metrics.putMetric(llmTokensPerSecondMetric(tokensPerSecond), [
			backendDimension,
		]),
	]);

	return result;
};
