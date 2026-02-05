'use client';
import React, { useContext, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthContext } from '@/app/template';
import { TranscriptionItemWithTranscript } from '@guardian/transcription-service-common';
import { authFetch } from '@/helpers';
import { TranscriptViewer } from '@/components/TranscriptViewer';
import { InfoMessage } from '@/components/InfoMessage';
import { RequestStatus } from '@/types';
import { Alert, Checkbox, Label } from 'flowbite-react';

const errorInfo = (message: string) => {
	return <InfoMessage message={message} status={RequestStatus.Failed} />;
};

const errorCheck = (
	token: string | undefined,
	transcriptId: string | null,
	error: string | null,
	mediaUrl: string | null,
	loading: boolean,
) => {
	if (!token) {
		return errorInfo('You must be logged in to view transcripts');
	}
	if (!transcriptId) {
		return errorInfo(
			'No transcript ID provided. Please provide a transcriptId in the URL.',
		);
	}
	if (loading) {
		return (
			<div className="flex justify-center items-center py-12">
				<div className="text-lg">Loading transcript...</div>
			</div>
		);
	}
	if (error) {
		return errorInfo(`Error: ${error}`);
	}
	if (!mediaUrl) {
		return errorInfo(
			'Failed to fetch source media, cannot show viewer - please export your transcript instead',
		);
	}
	return null;
};

const ViewerPage = () => {
	const { token } = useContext(AuthContext);
	const searchParams = useSearchParams();
	const transcriptId = searchParams.get('transcriptId');
	const transcriptIdNoTranslate = transcriptId?.replace('-translation', '');

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [transcriptData, setTranscriptData] =
		useState<TranscriptionItemWithTranscript | null>(null);
	const [mediaUrl, setMediaUrl] = useState<string | null>(null);
	const [isPublic, setIsPublic] = useState<boolean>(false);

	useEffect(() => {
		if (!token || !transcriptId) {
			setLoading(false);
			return;
		}

		const fetchData = async () => {
			try {
				const transcriptResponse = await authFetch(
					`/api/export/transcript?id=${transcriptId}&format=text`,
					token,
				);
				if (!transcriptResponse.ok) {
					throw new Error('Failed to fetch transcript');
				}

				const transcriptJson = await transcriptResponse.json();
				const parsedTranscript =
					TranscriptionItemWithTranscript.safeParse(transcriptJson);

				if (!parsedTranscript.success) {
					throw new Error('Invalid transcript data');
				}
				setTranscriptData(parsedTranscript.data);
				setIsPublic(parsedTranscript.data.item.isPublic ?? false);

				const mediaResponse = await authFetch(
					`/api/export/source-media-download-url?id=${transcriptIdNoTranslate}`,
					token,
				);

				if (mediaResponse.ok) {
					const url = await mediaResponse.text();
					setMediaUrl(url);
				} else {
					console.warn('Failed to fetch media URL, continuing without it');
				}
			} catch (err) {
				console.error('Error fetching viewer data:', err);
				setError(
					err instanceof Error ? err.message : 'Failed to load transcript',
				);
			} finally {
				setLoading(false);
			}
		};

		fetchData();
	}, [token, transcriptId]);

	const errorMessage = errorCheck(
		token,
		transcriptId,
		error,
		mediaUrl,
		loading,
	);

	const handleSetPublic = async (checked: boolean) => {
		if (!token || !transcriptIdNoTranslate) return;
		setIsPublic(checked);
		try {
			const response = await authFetch('/api/set-public', token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: transcriptIdNoTranslate,
					isPublic: checked,
				}),
			});
			if (!response.ok) {
				setIsPublic(!checked);
				console.error('Failed to update public status');
			}
		} catch (err) {
			setIsPublic(!checked);
			console.error('Error updating public status:', err);
		}
	};

	if (errorMessage) {
		return errorMessage;
	}

	if (!transcriptData) {
		return (
			<InfoMessage
				message="No transcript data found"
				status={RequestStatus.Failed}
			/>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-bold text-gray-900">
					{transcriptData.item.originalFilename}
				</h2>
			</div>
			<div>
				<Checkbox
					id="translation"
					checked={isPublic}
					onChange={(event) => handleSetPublic(event.target.checked)}
				/>
				<div className="flex flex-col">
					<Label htmlFor="translation" className="font-light text-base">
						Make transcript accessible to any Guardian staff with the link
					</Label>
				</div>
			</div>

			<Alert color="info" className="font-light">
				<span className="font-medium">Reminder:</span> Transcripts and source
				media will be deleted after 7 days. To keep a permanent copy,{' '}
				<a
					href={`/export?transcriptId=${transcriptId}`}
					className="font-medium underline hover:no-underline"
				>
					export your transcript
				</a>
				.
			</Alert>

			<TranscriptViewer
				transcript={transcriptData.transcript}
				mediaUrl={mediaUrl}
				filename={transcriptData.item.originalFilename}
			/>
		</div>
	);
};

export default ViewerPage;
