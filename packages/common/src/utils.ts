export const uploadToS3 = async (url: string, blob: Blob) => {
	try {
		const response = await fetch(url, {
			method: 'PUT',
			body: blob,
		});
		const status = response.status;
		return status === 200;
	} catch (error) {
		console.error('upload error:', error);
		return false;
	}
};
