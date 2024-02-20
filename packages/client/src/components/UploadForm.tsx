import { authFetch } from '@/helpers';
import React, { useContext, useState } from 'react';
import {
	SignedUrlResponseBody,
	uploadToS3,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import { FileInput, Label } from 'flowbite-react';
import { RequestStatus } from '@/types';
import { InfoMessage } from '@/components/InfoMessage';

const uploadFileAndTranscribe = async (file: File, token: string) => {
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
	if (!uploadStatus) {
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
		}),
	});
	const sendMessageSuccess = sendMessageResponse.status === 200;
	if (!sendMessageSuccess) {
		console.error('Failed to call transcribe-file');
		return false;
	}
	return true;
};

export const UploadForm = () => {
	const [status, setStatus] = useState<RequestStatus>(RequestStatus.Ready);
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const { token } = useContext(AuthContext);

	if (!token) {
		return (
			<InfoMessage message={'Login required'} status={RequestStatus.Failed} />
		);
	}

	if (status === RequestStatus.InProgress) {
		return (
			<InfoMessage
				message={'Upload in progress...'}
				status={RequestStatus.InProgress}
			/>
		);
	}

	if (status === RequestStatus.Failed) {
		return (
			<>
				<InfoMessage
					message={`${errorMessage ?? 'Upload failed'}`}
					status={RequestStatus.Failed}
				/>
				<button
					onClick={() => setStatus(RequestStatus.Ready)}
					className="font-medium text-blue-600 underline dark:text-blue-500 hover:no-underline"
				>
					Click here
				</button>{' '}
				to try again
			</>
		);
	}

	if (status === RequestStatus.Success) {
		return (
			<p className="text-gray-500 dark:text-gray-400 pt-3">
				Upload complete. Transcription in progress - check your email for the
				completed transcript. The transcription process is typically shorter
				than the length of the media file.{' '}
				<button
					onClick={() => setStatus(RequestStatus.Ready)}
					className="font-medium text-blue-600 underline dark:text-blue-500 hover:no-underline"
				>
					Click here
				</button>{' '}
				to transcribe another file
			</p>
		);
	}

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setStatus(RequestStatus.InProgress);

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

		for (const file of maybeFileInput.files) {
			const result = await uploadFileAndTranscribe(file, token);
			if (!result) {
				setStatus(RequestStatus.Failed);
				return;
			}
		}

		setStatus(RequestStatus.Success);
		maybeFileInput.value = '';
	};

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
