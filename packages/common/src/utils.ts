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
	blob: Blob | Buffer,
	gzipped: boolean = false,
): Promise<UploadResult> => {
	// NOTE: Content-Encoding header MUST match that specified in the presigned url
	const contentEncodingHeader: Record<string, string> = gzipped
		? { 'Content-Encoding': 'gzip' }
		: {};
	try {
		const response = await fetch(url, {
			method: 'PUT',
			body: blob,
			headers: {
				...contentEncodingHeader,
			},
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
		const errorMsg = `S3 upload failed: ${error}`;
		console.error(errorMsg, error);
		return {
			isSuccess: false,
			errorMsg,
		};
	}
};
