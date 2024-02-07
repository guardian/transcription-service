import { authFetch } from '@/helpers';
import { AuthState } from '@/types';
import { useState } from 'react';

const uploadToS3 = async (url: string, blob: Blob) => {
	try {
		const response = await fetch(url, {
			method: 'PUT',
			body: blob,
		});
		const status = await response.status;
		console.log('upload success:', status);
		return status == 200;
	} catch (error) {
		console.error('upload error:', error);
		return false;
	}
};

export const UploadForm = ({ auth }: { auth: AuthState }) => {
	console.log(auth);
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
		if (files == undefined || files.length == 0 || !files[0]) {
			return;
		}
		const file = files[0];
		const blob = new Blob([file as BlobPart]);

		const urlParams = new URLSearchParams({ fileName: file.name });
		const response = await authFetch(
			`/signedUrl?${urlParams.toString()}`,
			auth.token,
		);
		// TODO: parse response with zod
		const body = await response.json();

		const uploadSuccess = await uploadToS3(body.presignedS3Url, blob);
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
