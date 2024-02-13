// export const authFetch = async (url: string, token?: string) => {
// 	return await fetch(`api/${url}`, {
// 		headers: {
// 			Authorization: `Bearer ${token}`,
// 		},
// 	});
// };

export const authFetch = async (
	url: string,
	token?: string,
	init?: RequestInit,
): Promise<Response | null> => {
	console.log('lets go');
	if (!token) {
		console.error('Missing auth token');
		return null;
	}
	const request = new Request(url, init);

	request.headers.set('Authorization', `Bearer ${token}`);

	const authRequest = new Request(request, {
		headers: request.headers,
	});

	const res = await fetch(authRequest);
	return res;
};
