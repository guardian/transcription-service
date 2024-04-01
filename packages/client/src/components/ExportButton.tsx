import React, { useContext, useState } from 'react';
import {
	ExportResponse,
	TranscriptFormat,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import Script from 'next/script';
import { useSearchParams } from 'next/navigation';
import { exportTranscript } from '@/services/export';
import {
	ArrowTopRightOnSquareIcon,
	DocumentTextIcon,
} from '@heroicons/react/16/solid';
import { RequestStatus } from '@/types';
import { InfoMessage } from '@/components/InfoMessage';
import { Alert, CustomFlowbiteTheme, Dropdown, Flowbite } from 'flowbite-react';

const ExportButton = () => {
	const { token } = useContext(AuthContext);
	const searchParams = useSearchParams();
	const [docId, setDocId] = useState<string | undefined>();
	const [loading, setLoading] = useState(false);
	const [failureMessage, setFailureMessage] = useState<string>('');
	const [transcriptFormat, setTranscriptFormat] =
		useState<TranscriptFormat | null>(null);
	const [transcriptFormatValid, setTranscriptFormatValid] = useState<
		boolean | undefined
	>(undefined);
	const [requestStatus, setRequestStatus] = useState<RequestStatus>(
		RequestStatus.Ready,
	);
	// TODO: once we have some CSS/component library, tidy up this messy error handling
	if (!token) {
		return (
			<InfoMessage message={'not logged in'} status={RequestStatus.Failed} />
		);
	}

	const transcriptFormatDescription: Record<TranscriptFormat, string> = {
		srt: 'SRT format (Time Coded)',
		text: 'TEXT format',
		json: 'JSON format',
	};

	const transcriptId = searchParams.get('transcriptId');
	if (!transcriptId) {
		return (
			<InfoMessage
				message={'Cannot export - missing transcript id'}
				status={RequestStatus.Failed}
			/>
		);
	}
	if (requestStatus === RequestStatus.Failed) {
		return (
			<InfoMessage
				message={`Export failed with error ${failureMessage ?? 'unknown failure'}.
							Make sure that your browser isn't blocking pop-ups so that you can log in to your Google account.`}
				status={RequestStatus.Failed}
			/>
		);
	}
	if (loading) {
		return (
			<InfoMessage
				message={
					"Export in progress... If nothing happens, make sure that your browser isn't blocking pop-ups."
				}
				status={RequestStatus.InProgress}
			/>
		);
	}
	if (docId) {
		return (
			<a href={`https://docs.google.com/document/d/${docId}`} target={'_blank'}>
				<button
					type="button"
					className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
				>
					View transcript document
					<ArrowTopRightOnSquareIcon className={'w-6 h-6 pl-1'} />
				</button>
			</a>
		);
	}

	const exportHandler = async () => {
		if (!transcriptFormat) {
			console.log(`transcript format value is ${transcriptFormat}`);
			setTranscriptFormatValid(false);
			return;
		}
		setLoading(true);
		try {
			const response = await exportTranscript(
				token,
				transcriptId,
				transcriptFormat,
			);
			setLoading(false);
			if (response && response.status !== 200) {
				const text = await response.text();
				setFailureMessage(text);
				setRequestStatus(RequestStatus.Failed);
				return;
			}
			const json = await response.json();
			const parsedResponse = ExportResponse.safeParse(json);
			if (!parsedResponse.success) {
				console.error('Failed to parse export response', parsedResponse.error);
				setRequestStatus(RequestStatus.Failed);
				setFailureMessage(
					`Export succeeded but failed to get document id - check your Google Drive`,
				);
				return;
			}
			setDocId(parsedResponse.data.documentId);
			setRequestStatus(RequestStatus.Success);
		} catch (error) {
			console.error('Export failed', error);
			setFailureMessage("'Authentication with Google failed'");
			setRequestStatus(RequestStatus.Failed);
		}
	};

	const customTheme: CustomFlowbiteTheme = {
		alert: {
			color: {
				red: 'bg-red-100 text-red-900',
			},
		},
	};

	return (
		<>
			<Script src="https://accounts.google.com/gsi/client" async></Script>
			<div className="flex flex-col space-y-2 mb-8">
				<Dropdown
					color="gray"
					label={
						transcriptFormat === null
							? 'Choose transcript format'
							: transcriptFormatDescription[transcriptFormat]
					}
				>
					<Dropdown.Item
						value={TranscriptFormat.TEXT}
						onClick={() => {
							setTranscriptFormat(TranscriptFormat.TEXT);
							setTranscriptFormatValid(true);
						}}
					>
						{transcriptFormatDescription[TranscriptFormat.TEXT]}
					</Dropdown.Item>
					<Dropdown.Divider />
					<Dropdown.Item
						value={TranscriptFormat.SRT}
						onClick={() => {
							setTranscriptFormat(TranscriptFormat.SRT);
							setTranscriptFormatValid(true);
						}}
					>
						{transcriptFormatDescription[TranscriptFormat.SRT]}
					</Dropdown.Item>
				</Dropdown>
				<Flowbite theme={{ theme: customTheme }}>
					{transcriptFormatValid === false ? (
						<Alert className="font-light text-sm align-middle" color="red">
							A transcript format must be chosen!
						</Alert>
					) : null}
				</Flowbite>
			</div>

			<button
				type="button"
				className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
				onClick={exportHandler}
			>
				Click here to export transcript to Google Doc
				<DocumentTextIcon className={'w-6 h-6 pl-1'} />
			</button>
		</>
	);
};

export default ExportButton;
