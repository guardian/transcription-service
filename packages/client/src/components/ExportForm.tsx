import React, { useContext, useEffect, useState } from 'react';
import {
	DownloadUrls,
	ExportStatus,
	ExportStatuses,
	ExportType,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import Script from 'next/script';
import { useSearchParams } from 'next/navigation';
import {
	createExportFolder,
	exportTranscript,
	getOAuthToken,
} from '@/services/export';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/16/solid';
import { RequestStatus } from '@/types';
import { iconForExportStatus, InfoMessage } from '@/components/InfoMessage';
import {
	Alert,
	Checkbox,
	CustomFlowbiteTheme,
	Flowbite,
	Label,
} from 'flowbite-react';
import { authFetch } from '@/helpers';

const getDriveLink = (id: string, exportType: ExportType) => {
	return exportType === 'source-media'
		? `https://drive.google.com/file/d/${id}`
		: `https://docs.google.com/document/d/${id}`;
};

const getExportTypeText = (exportType: ExportType) => {
	switch (exportType) {
		case 'source-media':
			return 'Input media';
		case 'text':
			return 'Transcript text';
		case 'srt':
			return 'Transcript text with timecodes (SRT)';
		default:
			return 'Unknown export type';
	}
};

const updateExportTypes = (
	type: ExportType,
	value: boolean,
	currentExportTypes: ExportType[],
) => {
	if (value) {
		if (!currentExportTypes.includes(type)) {
			return [...currentExportTypes, type];
		}
		return currentExportTypes;
	} else {
		return currentExportTypes.filter((currentType) => currentType !== type);
	}
};

const statusToMessage = (status: RequestStatus): string => {
	switch (status) {
		case RequestStatus.Failed:
		case RequestStatus.PartialFailure:
			return 'One or more exports failed. See below for details';
		case RequestStatus.Success:
			return 'All exports complete. See below for links to your files';
		case RequestStatus.CreatingFolder:
			return "Export in progress... If nothing happens, make sure that your browser isn't blocking pop-ups.";
		case RequestStatus.TranscriptExportInProgress:
			return 'Export in progress. Links to your files will soon appear below.';
		case RequestStatus.InProgress:
			return `Export in progress. See below for links to your transcript files. Source media may take several 
			 minutes - you can stay on this page or click the button to open the google drive folder and wait 
			 for it to appear there.`;
		case RequestStatus.Ready:
		default:
			return '';
	}
};

const exportTypesToStatus = (exportTypes: ExportType[]): ExportStatuses => {
	return exportTypes.map((type) => ({
		status: 'in-progress',
		exportType: type,
	}));
};

const ExportForm = () => {
	const { token } = useContext(AuthContext);
	const searchParams = useSearchParams();
	const [folderId, setFolderId] = useState<string | undefined>();
	const [failureMessage, setFailureMessage] = useState<string>('');
	const [requestStatus, setRequestStatus] = useState<RequestStatus>(
		RequestStatus.Ready,
	);
	const [exportTypesRequested, setExportTypesRequested] = useState<
		ExportType[]
	>(['text']);
	const [exportStatuses, setExportStatuses] = useState<ExportStatuses>([]);
	const [downloadUrls, setDownloadUrls] = useState<DownloadUrls | undefined>(
		undefined,
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
	useEffect(() => {
		authFetch(`/api/export/download-urls?id=${transcriptId}`, token).then(
			(urls) => {
				const parsedUrls = DownloadUrls.safeParse(urls);
				if (!parsedUrls.success) {
					console.error(
						'Failed to parse download URLs response',
						parsedUrls.error,
					);
					return;
				}
				setDownloadUrls(parsedUrls.data);
			},
		);
	}, [transcriptId]);
	if (requestStatus === RequestStatus.Failed) {
		return (
			<InfoMessage
				message={`Export failed with error ${failureMessage ?? 'unknown failure.'}`}
				status={RequestStatus.Failed}
			/>
		);
	}

	if (requestStatus !== RequestStatus.Ready) {
		return (
			<>
				<div className="mb-6">
					<InfoMessage
						message={statusToMessage(requestStatus)}
						status={requestStatus}
					/>
					<div className={'ml-10'}>
						{exportStatuses.map((status: ExportStatus) => (
							<div className={'flex space-x-3'}>
								{iconForExportStatus(status)}
								{status.status === 'success' && (
									<a
										href={getDriveLink(status.id, status.exportType)}
										target={'_blank'}
										className={
											'underline text-blue-700 hover:text-blue-800 visited:text-purple-600'
										}
									>
										{getExportTypeText(status.exportType)}
									</a>
								)}
								{status.status === 'failure' && (
									<span className={'text-red-700'}>
										{getExportTypeText(status.exportType)} export failed
									</span>
								)}
								{status.status === 'in-progress' && (
									<span className={'text-yellow-700'}>
										{getExportTypeText(status.exportType)} export in progress
									</span>
								)}
							</div>
						))}
					</div>
				</div>

				<a
					href={`https://drive.google.com/drive/folders/${folderId}`}
					target={'_blank'}
				>
					<button
						type="button"
						className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
					>
						Go to export folder
						<ArrowTopRightOnSquareIcon className={'w-6 h-6 pl-1'} />
					</button>
				</a>
			</>
		);
	}

	const updateStatuses = async () => {
		const statusResponse = await authFetch(
			`/api/export/status?id=${transcriptId}`,
			token,
		);
		if (statusResponse.status === 200) {
			const json = await statusResponse.json();
			const parsedResponse = ExportStatuses.safeParse(json);
			if (!parsedResponse.success) {
				console.error(
					'Failed to parse export status response',
					parsedResponse.error,
				);
				return;
			}
			setExportStatuses(parsedResponse.data);
			const statuses = parsedResponse.data.map(
				(status: ExportStatus) => status.status,
			);
			if (statuses.includes('in-progress')) {
				setTimeout(updateStatuses, 2000);
			} else {
				if (statuses.includes('failure')) {
					setRequestStatus(RequestStatus.PartialFailure);
					setFailureMessage('One or more exports failed');
					return;
				}
				setRequestStatus(RequestStatus.Success);
			}
		}
	};

	const exportHandler = async () => {
		setRequestStatus(RequestStatus.CreatingFolder);
		try {
			const tokenResponse = await getOAuthToken(token);
			const createFolderResponse = await createExportFolder(
				token,
				tokenResponse,
				transcriptId,
			);
			if (createFolderResponse.status !== 200) {
				const text = await createFolderResponse.text();
				setFailureMessage(text);
				setRequestStatus(RequestStatus.Failed);
				return;
			}
			const folderId = await createFolderResponse.text();
			setRequestStatus(RequestStatus.TranscriptExportInProgress);
			setExportStatuses(exportTypesToStatus(exportTypesRequested));
			setFolderId(folderId);
			const exportResponse = await exportTranscript(
				token,
				tokenResponse,
				transcriptId,
				exportTypesRequested,
				folderId,
			);
			if (exportResponse.status !== 200) {
				const text = await exportResponse.text();
				setFailureMessage(text);
				setRequestStatus(RequestStatus.Failed);
				return;
			}
			const json = await exportResponse.json();
			const parsedResponse = ExportStatuses.safeParse(json);
			if (!parsedResponse.success) {
				console.error('Failed to parse export response', parsedResponse.error);
				setRequestStatus(RequestStatus.Failed);
				setFailureMessage(
					`Export succeeded but failed to get document ID. Check your Google Drive`,
				);
				return;
			}
			setRequestStatus(RequestStatus.InProgress);
			setExportStatuses(parsedResponse.data);
			await updateStatuses();
		} catch (error) {
			console.error('Export failed', error);
			setFailureMessage(
				"'Authentication with Google failed. Make sure that your browser isn't blocking pop-ups so that you can log in to your Google account.'",
			);
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

	const atLeastOneExport = () => exportTypesRequested.length > 0;

	return (
		<>
			<Script src="https://accounts.google.com/gsi/client" async></Script>
			<div className="flex flex-col space-y-2 mb-8">
				<div>
					<Label
						className="text-base"
						htmlFor="language-selector"
						value="What do you want to export?"
					/>
				</div>
				<p className="font-light">
					Exported items will be saved in the same folder in Google Drive
				</p>

				<div className="flex items-center gap-2">
					<Checkbox
						id="transcript-text"
						checked={exportTypesRequested.includes('text')}
						onChange={(e) =>
							setExportTypesRequested(
								updateExportTypes(
									'text',
									e.target.checked,
									exportTypesRequested,
								),
							)
						}
					/>
					<Label htmlFor="transcript-text">
						Transcript text (<a href={downloadUrls?.text}>Download</a>)
					</Label>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id="transcript-srt"
						checked={exportTypesRequested.includes('srt')}
						onChange={(e) =>
							setExportTypesRequested(
								updateExportTypes(
									'srt',
									e.target.checked,
									exportTypesRequested,
								),
							)
						}
					/>
					<Label htmlFor="transcript-srt">
						Transcript text with timecodes (SRT) (
						<a href={downloadUrls?.srt}>Download</a>)
					</Label>
				</div>
				<div className="flex gap-2">
					<div className="flex h-5 items-center">
						<Checkbox
							id="source-media"
							checked={exportTypesRequested.includes('source-media')}
							onChange={(e) =>
								setExportTypesRequested(
									updateExportTypes(
										'source-media',
										e.target.checked,
										exportTypesRequested,
									),
								)
							}
						/>
					</div>
					<div className="flex flex-col">
						<Label htmlFor="source-media">
							Input media (<a href={downloadUrls?.sourceMedia}>Download</a>)
						</Label>
						<div className="text-gray-500 dark:text-gray-300">
							<span className="text-xs font-normal">
								Max 10GB (roughly 3 hours of video)
							</span>
						</div>
					</div>
				</div>

				<Flowbite theme={{ theme: customTheme }}>
					{!atLeastOneExport() ? (
						<Alert className="font-light text-sm align-middle" color="red">
							Please select at least one item for export
						</Alert>
					) : null}
				</Flowbite>
			</div>

			<button
				type="button"
				className={`text-white px-5 py-2.5 text-center rounded-lg text-sm font-medium ${
					atLeastOneExport()
						? 'bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 inline-flex items-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800'
						: 'bg-blue-400 dark:bg-blue-500 cursor-not-allowed'
				}`}
				onClick={exportHandler}
				disabled={!atLeastOneExport()}
			>
				Export to Google Drive
			</button>
		</>
	);
};

export default ExportForm;
