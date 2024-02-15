import { authFetch } from '@/helpers';
import { useContext, useState } from 'react';
import {
	SignedUrlResponseBody,
	uploadToS3,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';

export const UploadForm = () => {
	const [status, setStatus] = useState<boolean | undefined>(undefined);
	const auth = useContext(AuthContext);
	const token = auth.token;

	if (!token) {
		return <p>Cannot upload - missing auth token</p>;
	}

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const maybeFileInput = document.querySelector(
			'input[name=file]',
		) as HTMLInputElement;
		if (!maybeFileInput) {
			return;
		}
		const files = maybeFileInput.files;
		if (files == undefined || files.length === 0 || !files[0]) {
			return;
		}
		const file = files[0];
		const blob = new Blob([file as BlobPart]);

		const response = await authFetch(`/api/signed-url`, token);
		if (!response) {
			console.error('Failed to fetch signed url');
			return;
		}

		const body = SignedUrlResponseBody.safeParse(await response.json());
		if (!body.success) {
			console.error('response from signedUrl endpoint in wrong shape');
			return;
		}

		const uploadStatus = await uploadToS3(body.data.presignedS3Url, blob);
		setStatus(uploadStatus.isSuccess);

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
		const sendMessageSuccess = sendMessageResponse.status !== 200;
		if (!sendMessageSuccess) {
			console.error('Failed to call transcribe-file');
			return;
		}

		if (uploadStatus.isSuccess) {
			maybeFileInput.value = '';
		}
	};

	const statusString =
		status === undefined ? '' : status ? 'Success' : 'Failure';

	return (
		<>
			<form id="media-upload-form" onSubmit={handleSubmit}>
				<label>
					file
					<input name="file" multiple={false} type="file"></input>
				</label>
				<label>
					<input type="submit"></input>
				</label>
			</form>
			<p id="upload-status">{statusString}</p>
		</>
	);
};
