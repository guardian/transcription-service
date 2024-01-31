import React from 'react';
import { useSearchParams, usePathname } from 'next/navigation';

export const AuthRequired = () => {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const params = new URLSearchParams(searchParams?.toString());
	params.append('returnPath', pathname || '');

	return (
		<div>
			<a href={`/api/auth/google?${params.toString()}`}>Click here</a>
			to log in with Google
		</div>
	);
};
