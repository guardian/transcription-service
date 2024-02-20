import { authFetch } from '@/helpers';
import { useContext, useState } from 'react';
import {
	SignedUrlResponseBody,
	uploadToS3,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import { FileInput, Label } from 'flowbite-react';

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

enum UploadStatus {
	Ready = 'Ready',
	InProgress = 'InProgress',
	Success = 'Success',
	Failed = 'Failed',
}

export const UploadForm = () => {
	const [status, setStatus] = useState<UploadStatus>(UploadStatus.Ready);
	const { token } = useContext(AuthContext);

	if (!token) {
		return <div>Not logged in</div>;
	}

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setStatus(UploadStatus.InProgress);

		const maybeFileInput = document.querySelector(
			'input[id=files]',
		) as HTMLInputElement;
		if (!maybeFileInput || !maybeFileInput.files) {
			return;
		}

		console.log(maybeFileInput.files);
		for (const file of maybeFileInput.files) {
			const result = await uploadFileAndTranscribe(file, token);
			if (!result) {
				setStatus(UploadStatus.Failed);
				return;
			}
		}

		setStatus(UploadStatus.Success);
		maybeFileInput.value = '';
	};

	const statusString =
		status === undefined ? '' : status ? 'Success' : 'Failure';

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
			<p id="upload-status">{statusString}</p>
		</>
	);
};
