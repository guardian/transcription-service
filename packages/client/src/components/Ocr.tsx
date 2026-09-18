'use client';
import React, { useContext, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
	Alert,
	Button,
	FileInput,
	Label,
	Spinner,
	TextInput,
} from 'flowbite-react';
import { AuthContext } from '@/app/template';
import { getOcrResult, submitOcr } from '@/services/ocr';
import { OcrResult } from '@guardian/transcription-service-common';

export const Ocr = () => {
	const { token } = useContext(AuthContext);
	const router = useRouter();
	const params = useSearchParams();
	const id = params.get('id');
	const [file, setFile] = useState<File | null>(null);
	const [language, setLanguage] = useState('eng');
	const [uploading, setUploading] = useState(false);
	const [result, setResult] = useState<OcrResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!id || !token) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		setResult(null);
		setError(null);
		const poll = async () => {
			try {
				const next = await getOcrResult(id, token);
				if (cancelled) return;
				if (next) setResult(next);
				else timer = setTimeout(poll, 3000);
			} catch (err) {
				if (!cancelled)
					setError(
						err instanceof Error ? err.message : 'Failed to fetch OCR result',
					);
			}
		};
		void poll();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [id, token]);

	const waiting = !!id && !result && !error;
	const busy = uploading || waiting;
	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!file || !token || busy) return;
		if (!/\.pdf$/i.test(file.name) || file.size === 0) {
			setError('Choose a non-empty PDF file');
			return;
		}
		setUploading(true);
		setResult(null);
		setError(null);
		try {
			const jobId = await submitOcr(file, language, token);
			router.replace(`/ocr?id=${encodeURIComponent(jobId)}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to submit OCR job');
		} finally {
			setUploading(false);
		}
	};

	return (
		<>
			<h2 className="text-2xl font-bold mb-3">OCR a PDF</h2>
			<p className="pb-4 font-light">
				Upload a scanned PDF to add searchable text, then download the processed
				PDF.
			</p>
			<form onSubmit={handleSubmit} className="max-w-xl space-y-4">
				<div>
					<Label htmlFor="ocr-file" value="PDF file" />
					<FileInput
						id="ocr-file"
						accept="application/pdf,.pdf"
						required
						disabled={busy}
						onChange={(event) => setFile(event.target.files?.[0] ?? null)}
					/>
				</div>
				<div>
					<Label htmlFor="ocr-language" value="OCR language code" />
					<TextInput
						id="ocr-language"
						value={language}
						required
						pattern="[a-z]{3}(\+[a-z]{3})*"
						disabled={busy}
						onChange={(event) => setLanguage(event.target.value)}
					/>
					<p className="text-sm text-gray-500">
						Use a three-letter code, such as eng for English, or eng+fra for
						multiple languages.
					</p>
				</div>
				<Button type="submit" disabled={!file || !token || busy}>
					{uploading ? 'Uploading…' : 'Run OCR'}
				</Button>
			</form>
			<div className="mt-4" aria-live="polite">
				{waiting && (
					<p>
						<Spinner size="sm" className="mr-2" />
						Waiting for OCR to finish…
					</p>
				)}
				{error && <Alert color="failure">{error}</Alert>}
				{result?.status === 'OCR_FAILURE' && (
					<Alert color="failure">{result.errorMessage}</Alert>
				)}
				{result?.status === 'OCR_SUCCESS' && (
					<Alert color="success">
						<a className="underline font-medium" href={result.downloadUrl}>
							Download OCR PDF
						</a>
					</Alert>
				)}
			</div>
		</>
	);
};
