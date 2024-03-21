import { authFetch } from '@/helpers';
import React, { useContext, useState } from 'react';
import {
	SignedUrlResponseBody,
	uploadToS3,
	languageCodeToLanguage,
	type LanguageCode,
	languageCodes,
	TranscribeFileRequestBody,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import { FileInput, Label, Select } from 'flowbite-react';
import { RequestStatus } from '@/types';
import { iconForStatus, InfoMessage } from '@/components/InfoMessage';

const uploadFileAndTranscribe = async (
	file: File,
	token: string,
	languageCode: LanguageCode,
) => {
	const blob = new Blob([file as BlobPart]);

	const response = await authFetch(`/api/signed-url`, token);
	if (!response) {
		console.error('Failed to fetch signed url');
		return false;
	}

	const body = SignedUrlResponseBody.safeParse(await response.json());
	if (!body.success) {
		console.error('response from signedUrl endpoint in wrong shape');
		return false;
	}

	const uploadStatus = await uploadToS3(body.data.presignedS3Url, blob);
	if (!uploadStatus.isSuccess) {
		console.error('Failed to upload to s3');
		return false;
	}

	const transcribeFileBody: TranscribeFileRequestBody = {
		s3Key: body.data.s3Key,
		fileName: file.name,
		languageCode,
	};

	const sendMessageResponse = await authFetch('/api/transcribe-file', token, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(transcribeFileBody),
	});
	const sendMessageSuccess = sendMessageResponse.status === 200;
	if (!sendMessageSuccess) {
		console.error('Failed to call transcribe-file');
		return false;
	}
	return true;
};

const updateFileStatus = (
	uploads: Record<string, RequestStatus>,
	index: number,
	fileName: string,
	newStatus: RequestStatus,
) => {
	const x = {
		...uploads,
		[`${index}-${fileName}`]: newStatus,
	};
	console.log('status', uploads, x);
	return x;
};

export const UploadForm = () => {
	const [status, setStatus] = useState<RequestStatus>(RequestStatus.Ready);
	const [files, setFiles] = useState<FileList | null>(null);
	const [uploads, setUploads] = useState<Record<string, RequestStatus>>({});
	const [mediaFileLanguageCode, setMediaFileLanguageCode] = useState<
		LanguageCode | undefined
	>(undefined);
	const [languageCodeValid, setLanguageCodeValid] = useState<
		boolean | undefined
	>(undefined);
	const { token } = useContext(AuthContext);

	const reset = () => {
		setStatus(RequestStatus.Ready);
		setUploads({});
		setFiles(null);
		setMediaFileLanguageCode(undefined);
		setLanguageCodeValid(undefined);
	};

	if (!token) {
		return (
			<InfoMessage message={'Login required'} status={RequestStatus.Failed} />
		);
	}

	if (status !== RequestStatus.Ready) {
		console.log(uploads);
		return (
			<>
				{Object.entries(uploads).length > 0 && (
					<div className={'pb-10'}>
						<h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
							Uploading files:
						</h2>

						<ul className="max-w-md space-y-2 text-gray-500 list-inside dark:text-gray-400">
							{Object.entries(uploads).map(([key, value]) => (
								<li className="flex items-center">
									<span className={'mr-1'}>{iconForStatus(value)}</span>
									{key}
								</li>
							))}
						</ul>
					</div>
				)}
				{(status === RequestStatus.Failed ||
					Object.values(uploads).includes(RequestStatus.Failed)) && (
					<div
						className="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50 dark:bg-gray-800 dark:text-red-400"
						role="alert"
					>
						<span className="font-medium">One or more uploads failed</span>{' '}
						<button
							onClick={() => reset()}
							className="font-medium text-blue-600 underline dark:text-blue-500 hover:no-underline"
						>
							Click here
						</button>{' '}
						to try again
					</div>
				)}
				{Object.entries(uploads).length > 0 &&
					Object.values(uploads).filter((s) => s !== RequestStatus.Success)
						.length === 0 && (
						<div
							className="p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50 dark:bg-gray-800 dark:text-green-400"
							role="alert"
						>
							<span className="font-medium">Upload complete. </span>{' '}
							Transcription in progress - check your email for the completed
							transcript. The service can take a few minutes to start up, but
							thereafter the transcription process is typically shorter than the
							length of the media file.{' '}
							<button
								onClick={() => reset()}
								className="font-medium text-blue-600 underline dark:text-blue-500 hover:no-underline"
							>
								Click here
							</button>{' '}
							to transcribe another file
						</div>
					)}
			</>
		);
	}

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		// The react Select components with a required property don't show any
		// feedback when the form is submitted without an option having been
		// chosen. We need to validate that input manually.
		if (mediaFileLanguageCode === undefined) {
			setLanguageCodeValid(false);
			return;
		}

		// the required property on the file input should prevent the form from
		// being submitted without any files selected. Need to confirm this in
		// order to narrow the type of files
		if (files === null || files.length === 0) {
			return;
		}

		setStatus(RequestStatus.InProgress);
		const fileArray = Array.from(files);
		const fileIds = fileArray.map((f, index) => [
			`${index}-${f.name}`,
			RequestStatus.InProgress,
		]);
		setUploads(Object.fromEntries(fileIds));

		for (const [index, file] of fileArray.entries()) {
			const result = await uploadFileAndTranscribe(
				file,
				token,
				mediaFileLanguageCode,
			);
			if (!result) {
				setUploads((prev) =>
					updateFileStatus(prev, index, file.name, RequestStatus.Failed),
				);
				setStatus(RequestStatus.Failed);
			} else {
				setUploads((prev) =>
					updateFileStatus(prev, index, file.name, RequestStatus.Success),
				);
			}
		}

		setStatus(RequestStatus.Success);
	};

	const languageSelectColor = languageCodeValid === false ? 'red' : '';

	return (
		<>
			<form id="media-upload-form" onSubmit={handleSubmit}>
				<div className="mb-6">
					<div>
						<Label
							className="text-base"
							htmlFor="multiple-file-upload"
							value="File(s) for transcription"
						/>
					</div>
					<FileInput
						id="files"
						required={true}
						multiple
						onChange={(e) => {
							setFiles(e.target.files);
						}}
					/>
				</div>
				<div className="mb-6">
					<div>
						<Label
							className="text-base"
							htmlFor="language-selector"
							value="Audio language"
						/>
					</div>
					<p className="font-light">
						Choosing a specific language may give you more accurate results.
					</p>
					<Select
						id="language-selector"
						style={{
							color: languageSelectColor,
							borderColor: languageSelectColor,
						}}
						onChange={(e) => {
							setMediaFileLanguageCode(e.target.value as LanguageCode);
							setLanguageCodeValid(true);
						}}
					>
						<option disabled selected>
							Select a language
						</option>
						{languageCodes.map((languageCode: LanguageCode) => (
							<option key={languageCode} value={languageCode}>
								{languageCodeToLanguage[languageCode]}
							</option>
						))}
					</Select>
				</div>
				<button
					type="submit"
					className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
				>
					Submit
				</button>
			</form>
		</>
	);
};
