import React, { useContext, useState } from 'react';
import { ExportResponse } from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import Script from 'next/script';
import { useSearchParams } from 'next/navigation';
import { exportTranscript } from '@/services/export';
import {
	ArrowTopRightOnSquareIcon,
	DocumentTextIcon,
	ExclamationTriangleIcon,
} from '@heroicons/react/16/solid';
import { Spinner } from 'flowbite-react';

enum ExportStatus {
	Ready = 'Ready',
	Complete = 'Complete',
	Error = 'Error',
	InProgress = 'InProgress',
}

const iconForStatus = (status: ExportStatus) => {
	switch (status) {
		case ExportStatus.InProgress:
			return <Spinner className={'w-6 h-6'} />;
		case ExportStatus.Error:
			return <ExclamationTriangleIcon className={'w-6 h-6'} />;
		default:
			return null;
	}
};
const messageWithIcon = (message: string, status: ExportStatus) => {
	return (
		<div className={'flex space-x-3'}>
			{iconForStatus(status)}
			<p className={'mb-3 text-gray-500 dark:text-gray-400'}>{message}</p>
		</div>
	);
};

const ExportButton = () => {
	const { token } = useContext(AuthContext);
	const searchParams = useSearchParams();
	const [docId, setDocId] = useState<string | undefined>();
	const [loading, setLoading] = useState(false);
	const [failureMessage, setFailureMessage] = useState<string>('');
	const [exportStatus, setExportStatus] = useState<ExportStatus>(
		ExportStatus.Ready,
	);
	// TODO: once we have some CSS/component library, tidy up this messy error handling
	if (!token) {
		return messageWithIcon('Not logged in', ExportStatus.Error);
	}
	const transcriptId = searchParams.get('transcriptId');
	if (!transcriptId) {
		return messageWithIcon(
			'Cannot export - missing transcript id',
			ExportStatus.Error,
		);
	}
	if (exportStatus === ExportStatus.Error) {
		return messageWithIcon(
			`Export failed with error ${failureMessage ?? 'unknown failure'}`,
			ExportStatus.Error,
		);
	}
	if (loading) {
		return messageWithIcon('Export in progress...', ExportStatus.InProgress);
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
				setExportStatus(ExportStatus.Error);
				return;
			}
			const json = await response.json();
			const parsedResponse = ExportResponse.safeParse(json);
			if (!parsedResponse.success) {
				console.error('Failed to parse export response', parsedResponse.error);
				setExportStatus(ExportStatus.Error);
				setFailureMessage(
					`Export succeeded but failed to get document id - check your google drive`,
				);
				return;
			}
			setDocId(parsedResponse.data.documentId);
			setExportStatus(ExportStatus.Complete);
		} catch (error) {
			console.error('Export failed', error);
			setFailureMessage("'Authentication with google failed'");
			setExportStatus(ExportStatus.Error);
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
				Click here to export transcript to google doc
				<DocumentTextIcon className={'w-6 h-6 pl-1'} />
			</button>
		</>
	);
};

export default ExportButton;
