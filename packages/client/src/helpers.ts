export const authFetch = async (url: string, token?: string) => {
	return await fetch(`api/${url}`, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});
};
