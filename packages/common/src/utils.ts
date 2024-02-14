export const uploadToS3 = async (url: string, blob: Blob) => {
	try {
		const response = await fetch(url, {
			method: 'PUT',
			body: blob,
		});
		const status = response.status;
		const isSuccess = status === 200;
		if (!isSuccess) {
			console.log(`S3 upload status is ${status} - ${response.statusText}`);
			const responseText = await response.text();
			console.log('responseText: ', responseText);
		}

		return isSuccess;
	} catch (error) {
		console.error('upload error:', error);
		return false;
	}
};
