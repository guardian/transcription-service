'use client';
import React, { useContext, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthContext } from '@/app/template';
import { TranscriptionItemWithTranscript } from '@guardian/transcription-service-common';
import { authFetch } from '@/helpers';
import { TranscriptViewer } from '@/components/TranscriptViewer';
import { InfoMessage } from '@/components/InfoMessage';
import { RequestStatus } from '@/types';
import { Alert } from 'flowbite-react';

const errorCheck = (
	token: string | undefined,
	transcriptId: string | null,
	error: string | null,
	mediaUrl: string | null,
): string | null => {
	if (!token) {
		return 'You must be logged in to view transcripts';
	}
	if (!transcriptId) {
		return 'No transcript ID provided. Please provide a transcriptId in the URL.';
	}
	if (error) {
		return `Error: ${error}`;
	}
	if (!mediaUrl) {
		return 'Failed to fetch source media, cannot show viewer - please export your transcript instead';
	}
	return null;
};

const ViewerPage = () => {
	const { token } = useContext(AuthContext);
	const searchParams = useSearchParams();
	const transcriptId = searchParams.get('transcriptId');

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [transcriptData, setTranscriptData] =
		useState<TranscriptionItemWithTranscript | null>(null);
	const [mediaUrl, setMediaUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!token || !transcriptId) {
			setLoading(false);
			return;
		}

		const fetchData = async () => {
			try {
				// Fetch transcript data
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

				// Fetch media URL
				const mediaResponse = await authFetch(
					`/api/export/source-media-download-url?id=${transcriptId}`,
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

	const errorMessage = errorCheck(token, transcriptId, error, mediaUrl);
	if (errorMessage) {
		return <InfoMessage message={errorMessage} status={RequestStatus.Failed} />;
	}

	if (loading) {
		return (
			<div className="flex justify-center items-center py-12">
				<div className="text-lg">Loading transcript...</div>
			</div>
		);
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
