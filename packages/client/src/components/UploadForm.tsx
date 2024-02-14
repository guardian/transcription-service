import { authFetch } from '@/helpers';
import { AuthState } from '@/types';
import { useState } from 'react';
import {
	SignedUrlResponseBody,
	uploadToS3,
} from '@guardian/transcription-service-common';

export const UploadForm = ({ auth }: { auth: AuthState }) => {
	const [status, setStatus] = useState<boolean | undefined>(undefined);

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

		const urlParams = new URLSearchParams({ fileName: file.name });
		const response = await authFetch(
			`/signedUrl?${urlParams.toString()}`,
			auth.token,
		);

		const body = SignedUrlResponseBody.safeParse(await response.json());
		if (!body.success) {
			console.error('response from signedUrl endpoint in wrong shape');
			return;
		}

		const uploadSuccess = await uploadToS3(body.data.presignedS3Url, blob);
		setStatus(uploadSuccess);
		if (uploadSuccess) {
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
