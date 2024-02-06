import { authFetch } from '@/helpers';
import { AuthState } from '@/types';

const uploadToS3 = async (url: string, formData: FormData) => {
	try {
		const response = await fetch(url, {
			method: 'PUT',
			body: formData,
		});
		const result = await response.json();
		console.log('Success:', result);
	} catch (error) {
		console.error('Error:', error);
	}
};

export const UploadForm = ({ auth }: { auth: AuthState }) => {
	console.log(auth);

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		console.log(event);
		const response = await authFetch('/signedUrl', auth.token);
		const body = await response.json();

		const formData = new FormData();
		// const fileField = event.target;
		console.log(event.target);

		// formData.append('file', fileField.files[0]);

		// TODO: zod
		uploadToS3(body.presignedS3Url, formData);
		console.log(body);
	};
	return (
		<form onSubmit={handleSubmit}>
			<label>
				file
				<input name="file" type="file"></input>
			</label>
			<label>
				<input type="submit"></input>
			</label>
		</form>
	);
};
