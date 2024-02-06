import { authFetch } from '@/helpers';
import { AuthState } from '@/types';

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

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const response = await authFetch('/signedUrl', auth.token);
		// TODO: parse response with zod
		const body = await response.json();

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
		const blob = new Blob([files[0] as BlobPart]);

		await uploadToS3(body.presignedS3Url, blob);
	};
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
			<p id="upload-status"></p>
		</>
	);
};
