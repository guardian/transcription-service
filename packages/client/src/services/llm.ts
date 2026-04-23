import { authFetch } from '@/helpers';
import {
	type LlmBackend,
	LlmPrompt,
	LlmResult,
} from '@guardian/transcription-service-common';

export const getResult = async (
	id: string,
	token: string,
): Promise<LlmResult | undefined> => {
	const response = await authFetch(`/api/llm-prompt?id=${id}`, token);
	if (!response.ok) {
		return undefined;
	}
	const data = await response.json();
	const parsedResponse = LlmResult.safeParse(data);
	if (!parsedResponse.success) {
		console.error('Failed to parse llm result', data);
		return undefined;
	}
	return parsedResponse.data;
};

export const submitPrompt = async (
	prompt: LlmPrompt,
	token: string,
	backend: LlmBackend,
): Promise<string> => {
	const response = await authFetch('/api/llm-prompt', token, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ prompt, backend }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || 'Failed to submit prompt');
	}

	const data = await response.json();
	return data.id;
};
