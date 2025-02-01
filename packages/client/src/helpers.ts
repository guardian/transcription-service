export const authFetch = async (
	url: string,
	token: string,
	init?: RequestInit,
): Promise<Response> => {
	const request = new Request(url, init);
	request.headers.set('Authorization', `Bearer ${token}`);

	return await fetch(request);
};

export const addHttpsProtocol = (url: string) => {
	if (url.startsWith('http://') || url.startsWith('https://')) {
		return url;
	} else return `https://${url}`;
};
