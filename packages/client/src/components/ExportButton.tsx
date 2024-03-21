import React, { useContext, useState } from 'react';
import { ExportResponse } from '@guardian/transcription-service-common';
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

const ExportButton = () => {
	const { token } = useContext(AuthContext);
	const searchParams = useSearchParams();
	const [docId, setDocId] = useState<string | undefined>();
	const [loading, setLoading] = useState(false);
	const [failureMessage, setFailureMessage] = useState<string>('');
	const [requestStatus, setRequestStatus] = useState<RequestStatus>(
		RequestStatus.Ready,
	);
	// TODO: once we have some CSS/component library, tidy up this messy error handling
	if (!token) {
		return (
			<InfoMessage message={'not logged in'} status={RequestStatus.Failed} />
		);
	}
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
		setLoading(true);
		try {
			const response = await exportTranscript(token, transcriptId);
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

	return (
		<>
			<Script src="https://accounts.google.com/gsi/client" async></Script>
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
