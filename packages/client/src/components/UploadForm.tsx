import { authFetch } from '@/helpers';
import React, { useContext, useState } from 'react';
import {
	SignedUrlResponseBody,
	uploadToS3,
	languageCodeToLanguage,
	type LanguageCode,
	languageCodes,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import { FileInput, Label } from 'flowbite-react';
import { RequestStatus } from '@/types';
import { iconForStatus, InfoMessage } from '@/components/InfoMessage';
import { Dropdown } from 'flowbite-react';

const uploadFileAndTranscribe = async (
	file: File,
	token: string,
	languageCode: LanguageCode | null,
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

	const sendMessageResponse = await authFetch('/api/transcribe-file', token, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			s3Key: body.data.s3Key,
			fileName: file.name,
			languageCode,
		}),
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
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const [uploads, setUploads] = useState<Record<string, RequestStatus>>({});
	const [mediaFileLanguageCode, setMediaFileLanguageCode] =
		useState<LanguageCode | null>(null);
	const { token } = useContext(AuthContext);

	const reset = () => {
		setStatus(RequestStatus.Ready);
		setErrorMessage(undefined);
		setUploads({});
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
						<span className="font-medium">
							{errorMessage ?? 'One or more uploads failed'}
						</span>{' '}
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
							thereafter the transcription process is typically shorter than
							the length of the media file.{' '}
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

		const maybeFileInput = document.querySelector(
			'input[id=files]',
		) as HTMLInputElement;
		if (
			!maybeFileInput ||
			!maybeFileInput.files ||
			maybeFileInput.files.length === 0
		) {
			setErrorMessage(
				'Invalid file input - did you select a file to transcribe?',
			);
			setStatus(RequestStatus.Failed);
			return;
		}
		setStatus(RequestStatus.InProgress);
		const fileArray = Array.from(maybeFileInput.files);
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
		maybeFileInput.value = '';
	};

	const detectLanguageLabel = 'Auto detect language';

	return (
		<>
			<form id="media-upload-form" onSubmit={handleSubmit}>
				<div className="mb-6">
					<div>
						<Label
							htmlFor="multiple-file-upload"
							value="File(s) for transcription"
						/>
					</div>
					<FileInput id="files" multiple />
				</div>
				<div className="mb-6">
					<div>
						<Label htmlFor="language-selector" value="Audio language" />
					</div>
					<Dropdown
						label={
							mediaFileLanguageCode
								? languageCodeToLanguage[mediaFileLanguageCode]
								: detectLanguageLabel
						}
						dismissOnClick={true}
						color="gray"
					>
						<Dropdown.Item
							key={undefined}
							value={undefined}
							onClick={() => {
								setMediaFileLanguageCode(null);
							}}
						>
							{detectLanguageLabel}
						</Dropdown.Item>
						<Dropdown.Divider />
						{languageCodes.map((languageCode: LanguageCode) => (
							<Dropdown.Item
								key={languageCode}
								value={languageCode}
								onClick={() => {
									setMediaFileLanguageCode(languageCode);
								}}
							>
								{languageCodeToLanguage[languageCode]}
							</Dropdown.Item>
						))}
					</Dropdown>
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
