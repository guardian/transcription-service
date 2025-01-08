import React, { useContext, useState } from 'react';
import { ExportResponse } from '@guardian/transcription-service-common';
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
import { InfoMessage } from '@/components/InfoMessage';
import {
	Alert,
	Checkbox,
	CustomFlowbiteTheme,
	Flowbite,
	Label,
	List,
} from 'flowbite-react';

const getDriveLink = (id: string, docType: 'document' | 'file') => {
	return docType === 'document'
		? `https://docs.google.com/document/d/${id}`
		: `https://drive.google.com/file/d/${id}`;
};

const makeFileLinks = (
	exportResponse: ExportResponse,
): { url: string; text: string }[] => {
	const links = [];
	if (exportResponse.textDocumentId) {
		links.push({
			url: getDriveLink(exportResponse.textDocumentId, 'document'),
			text: 'Transcript text',
		});
	}
	if (exportResponse.srtDocumentId) {
		links.push({
			url: getDriveLink(exportResponse.srtDocumentId, 'document'),
			text: 'Transcript text with timecodes (SRT)',
		});
	}
	if (exportResponse.sourceMediaFileId) {
		links.push({
			url: getDriveLink(exportResponse.sourceMediaFileId, 'file'),
			text: 'Original source media',
		});
	}
	return links;
};

const ExportButton = () => {
	const { token } = useContext(AuthContext);
	const searchParams = useSearchParams();
	const [folderId, setFolderId] = useState<string | undefined>();
	const [creatingFolder, setCreatingFolder] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [failureMessage, setFailureMessage] = useState<string>('');
	const [requestStatus, setRequestStatus] = useState<RequestStatus>(
		RequestStatus.Ready,
	);
	const [exportText, setExportText] = useState<boolean>(true);
	const [exportSrt, setExportSrt] = useState<boolean>(false);
	const [exportMedia, setExportMedia] = useState<boolean>(false);
	const [exportResponse, setExportResponse] = useState<ExportResponse>({});

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
				message={`Export failed with error ${failureMessage ?? 'unknown failure.'}
							Make sure that your browser isn't blocking pop-ups so that you can log in to your Google account.`}
				status={RequestStatus.Failed}
			/>
		);
	}
	if (creatingFolder) {
		return (
			<InfoMessage
				message={
					"Export in progress... If nothing happens, make sure that your browser isn't blocking pop-ups."
				}
				status={RequestStatus.InProgress}
			/>
		);
	}
	if (folderId) {
		return (
			<>
				{exporting ? (
					<InfoMessage
						message={
							'Export in progress. Your transcript text should be available immediately, source media may take a few minutes. Use the button below to check the folder where exported items will end up'
						}
						status={RequestStatus.InProgress}
					/>
				) : (
					<div className="mb-6">
						<InfoMessage
							message={`Export complete, see below for links to your files`}
							status={RequestStatus.Success}
						/>
						<div className={'ml-10'}>
							<List>
								{makeFileLinks(exportResponse).map(
									({ url, text }: { url: string; text: string }) => (
										<List.Item icon={ArrowTopRightOnSquareIcon}>
											<a
												href={url}
												target={'_blank'}
												className={
													'underline text-blue-700 hover:text-blue-800 visited:text-purple-600'
												}
											>
												{text}
											</a>
										</List.Item>
									),
								)}
							</List>
						</div>
					</div>
				)}
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

	const exportHandler = async () => {
		setCreatingFolder(true);
		setExporting(true);
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
			setCreatingFolder(false);
			setFolderId(folderId);
			const exportResponse = await exportTranscript(
				token,
				tokenResponse,
				transcriptId,
				{
					transcriptText: exportText,
					transcriptSrt: exportSrt,
					sourceMedia: exportMedia,
				},
				folderId,
			);
			if (exportResponse.status !== 200) {
				const text = await exportResponse.text();
				setFailureMessage(text);
				setRequestStatus(RequestStatus.Failed);
				return;
			}
			const json = await exportResponse.json();
			const parsedResponse = ExportResponse.safeParse(json);
			if (!parsedResponse.success) {
				console.error('Failed to parse export response', parsedResponse.error);
				setRequestStatus(RequestStatus.Failed);
				setFailureMessage(
					`Export succeeded but failed to get document id - check your Google Drive`,
				);
				return;
			}
			setExporting(false);
			setExportResponse(parsedResponse.data);
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

	const atLeastOneExport = () => exportText || exportSrt || exportMedia;

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
					Exported items will be saved in the same folder in google drive
				</p>

				<div className="flex items-center gap-2">
					<Checkbox
						id="transcript-text"
						checked={exportText}
						onChange={() => setExportText(!exportText)}
					/>
					<Label htmlFor="transcript-text">Transcript text</Label>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id="transcript-srt"
						checked={exportSrt}
						onChange={() => setExportSrt(!exportSrt)}
					/>
					<Label htmlFor="transcript-srt">
						Transcript text with timecodes (SRT)
					</Label>
				</div>
				<div className="flex gap-2">
					<div className="flex h-5 items-center">
						<Checkbox
							id="source-media"
							checked={exportMedia}
							onChange={() => setExportMedia(!exportMedia)}
						/>
					</div>
					<div className="flex flex-col">
						<Label htmlFor="source-media">Original source media</Label>
						<div className="text-gray-500 dark:text-gray-300">
							<span className="text-xs font-normal">
								Max 10GB, roughly 3 hours of video
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

export default ExportButton;
