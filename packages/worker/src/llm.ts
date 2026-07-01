import { executePrompt } from './llama-server';
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

// To begin with we limit each request to roughly this many tokens of source text. The system prompt and
// the small fragment note we add are extra, but the model's context window has headroom for them.
const MAX_INPUT_TOKENS_PER_CHUNK = 5000;

// For setting sqs visibility timeout - allow 10 minutes per chunk (based off basic testing of 2 jobs)
const SECONDS_PER_CHUNK = 60 * 10;

// Both backends use Qwen models which share a tokenizer close to cl100k_base.
const enc = getEncoding('cl100k_base');
const estimateTokens = (text: string): number => enc.encode(text).length;

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

const runAndCombinePrompts = async (
	prompts: LlmPrompt[],
	runPrompt: (prompt: LlmPrompt) => Promise<string>,
): Promise<string> => {
	const outputs: string[] = [];
	for (const [index, prompt] of prompts.entries()) {
		logger.info(
			`Running LLM prompt ${index + 1}/${prompts.length} with user prompt length ${prompt.user.length} chars.`,
		);
		const promptResult = await runPrompt(prompt);
		outputs.push(promptResult);
	}
	return outputs.join('');
};

export const executeLlmPrompt = async (
	prompt: LlmPrompt,
	config: TranscriptionConfig,
	backend: LlmBackend,
	setMessageVisibility: (visibilityTimeoutSeconds: number) => Promise<void>,
): Promise<string> => {
	// Replace URLs and emails with placeholders so they aren't translated and don't waste tokens.
	const { maskedText, maskLookup } = maskUrlsAndEmails(prompt.user);

	// The model context window is limited, so break a large user prompt into chunks of at most
	// MAX_INPUT_TOKENS_PER_CHUNK tokens
	const chunks = await textSplitter.splitText(maskedText);

	const visibilityTimeout = chunks.length * SECONDS_PER_CHUNK;
	logger.info(
		`Executing LLM prompt on ${backend} backend: ${estimateTokens(prompt.user)} estimated input tokens split into ${chunks.length} chunk(s), setting visibility timeout to ${visibilityTimeout}s`,
	);
	await setMessageVisibility(visibilityTimeout);

	// A single chunk is the whole document - send it unchanged. Otherwise mark each chunk as a fragment.
	const prompts: LlmPrompt[] =
		chunks.length <= 1
			? [{ system: prompt.system, user: maskedText }]
			: chunks.map((user) => ({
					system: addChunkingNote(prompt.system),
					user,
				}));

	const sendPrompt = async (chunkPrompt: LlmPrompt) => {
		if (backend === 'BEDROCK') {
			return sendPromptToBedrock(chunkPrompt, config.bedrock.modelId);
		} else {
			return executePrompt(config, chunkPrompt);
		}
	};

	const combined = await runAndCombinePrompts(prompts, (chunkPrompt) =>
		sendPrompt(chunkPrompt),
	);
	return restoreMaskedItems(combined, maskLookup);
};
