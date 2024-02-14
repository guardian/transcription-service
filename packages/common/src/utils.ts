interface UploadSuccess {
	isSuccess: true;
}

interface UploadFailure {
	isSuccess: false;
	errorMsg?: string;
}

type UploadResult = UploadSuccess | UploadFailure;

export const uploadToS3 = async (
	url: string,
	blob: Blob,
): Promise<UploadResult> => {
	try {
		const response = await fetch(url, {
			method: 'PUT',
			body: blob,
		});
		const status = response.status;
		const isSuccess = status === 200;
		if (!isSuccess) {
			// Passing the error message to the caller, since this
			// function is used both in client and server. We might
			// not want to log the error in the client
			const responseText = await response.text();
			const errorMsg = `S3 upload failed, status is ${status} - ${response.statusText} \n Error message: ${responseText}`;
			return {
				isSuccess: false,
				errorMsg: errorMsg,
			};
		}

		return {
			isSuccess: true,
		};
	} catch (error) {
		console.error('upload error:', error);
		return {
			isSuccess: false,
		};
	}
};
