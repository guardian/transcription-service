'use client';
import React, { useContext, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AuthContext } from '@/app/template';
import { authFetch } from '@/helpers';
import { Alert, Label, Spinner } from 'flowbite-react';
import { RequestStatus } from '@/types';
import { LlmResult } from '@guardian/transcription-service-common';
import { PromptField } from '@/components/PromptField';
const POLL_INTERVAL_MS = 3000;

const getResult = async (
	id: string,
	token: string,
): Promise<LlmResult | undefined> => {
	const response = await authFetch(`/api/llm-prompt?id=${id}`, token);
	if (!response.ok) {
		// Item not in dynamo yet — keep polling
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

export const Prompt = () => {
	const { token } = useContext(AuthContext);
	const searchParams = useSearchParams();
	const router = useRouter();
	const [systemPrompt, setSystemPrompt] = useState('');
	const [userPrompt, setUserPrompt] = useState('');
	const [assistantPrompt, setAssistantPrompt] = useState('');
	const [status, setStatus] = useState<RequestStatus>(RequestStatus.Ready);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [result, setResult] = useState<LlmResult | null>(null);
	const [promptId, setPromptId] = useState<string | null>(
		searchParams.get('id'),
	);

	if (!token) {
		return (
			<Alert color="failure">
				<span>Login required</span>
			</Alert>
		);
	}

	const setIdInQueryString = (id: string) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set('id', id);
		router.replace(`?${params.toString()}`);
	};

	const poll = async (id: string) => {
		const result = await getResult(id, token);
		if (result) {
			console.log(result);
			if (result.prompt) {
				setUserPrompt(result.prompt);
			}
			setResult(result);
			setStatus(RequestStatus.Success);
		} else {
			setTimeout(() => poll(id), POLL_INTERVAL_MS);
		}
	};

	useEffect(() => {
		if (promptId) {
			poll(promptId);
		}
	}, [token, promptId]);

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		if (!userPrompt.trim()) {
			return;
		}

		setStatus(RequestStatus.InProgress);
		setErrorMessage(null);
		setResult(null);

		try {
			const response = await authFetch('/api/llm-prompt', token, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					prompts: {
						system: systemPrompt.trim(),
						user: userPrompt.trim(),
						assistant: assistantPrompt.trim(),
					},
				}),
			});

			if (!response.ok) {
				const text = await response.text();
				throw new Error(text || 'Failed to submit prompt');
			}

			const data = await response.json();
			const id = data.id as string;
			setIdInQueryString(id);
			setPromptId(id);
			poll(id);
			setStatus(RequestStatus.WaitingForLlmResult);
		} catch (err) {
			setStatus(RequestStatus.Failed);
			setErrorMessage(
				err instanceof Error ? err.message : 'An unexpected error occurred',
			);
		}
	};

	const isSubmitting = status === RequestStatus.InProgress;

	return (
		<>
			<p className="pb-3 font-light">Send a prompt to the LLM.</p>

			{status === RequestStatus.Failed && errorMessage && (
				<Alert color="failure" className="mb-4">
					<span>Error: {errorMessage}</span>
				</Alert>
			)}

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Left column — form */}
				<div>
					<form onSubmit={handleSubmit}>
						<PromptField
							id="system-prompt"
							label="System prompt"
							description="Optional. Sets the behaviour and context for the LLM."
							value={systemPrompt}
							onChange={setSystemPrompt}
							rows={3}
						/>

						<PromptField
							id="user-prompt"
							label="User prompt"
							description="Required. The main instruction or question for the LLM."
							value={userPrompt}
							onChange={setUserPrompt}
							rows={6}
						/>

						<PromptField
							id="assistant-prompt"
							label="Assistant prompt"
							description="Optional. Pre-fill the start of the assistant's response."
							value={assistantPrompt}
							onChange={setAssistantPrompt}
							rows={3}
						/>

						<button
							type="submit"
							disabled={!userPrompt.trim() || isSubmitting}
							className={`text-white px-5 py-2.5 text-center rounded-lg text-sm font-medium inline-flex items-center ${
								!userPrompt.trim() || isSubmitting
									? 'bg-blue-400 dark:bg-blue-500 cursor-not-allowed'
									: 'bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800'
							}`}
						>
							{isSubmitting && <Spinner size="sm" className="mr-2" />}
							{isSubmitting ? 'Sending...' : 'Send prompt'}
						</button>
					</form>
				</div>

				{/* Right column — result */}
				<div>
					<Label className="text-base" value="Result" />
					<div className="mt-2 min-h-[200px] rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-700">
						{status !== RequestStatus.WaitingForLlmResult && !result && (
							<p className="text-gray-400 italic">
								Submit a prompt to see the result here.
							</p>
						)}

						{status == RequestStatus.WaitingForLlmResult && (
							<div className="flex items-center space-x-3">
								<Spinner size="md" />
								<span className="text-gray-500">
									Waiting for LLM response...
								</span>
							</div>
						)}

						{result?.status === 'LLM_SUCCESS' && result.output && (
							<pre className="whitespace-pre-wrap font-mono text-sm text-gray-800 dark:text-gray-200">
								{result.output}
							</pre>
						)}

						{result?.status === 'LLM_FAILURE' && (
							<Alert color="failure">
								<span>{result.errorMessage || 'LLM processing failed.'}</span>
							</Alert>
						)}
					</div>
				</div>
			</div>
		</>
	);
};
