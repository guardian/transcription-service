import React, { Suspense } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';

const AuthWithReturnPath = () => {
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

export const AuthRequired = () => {
	return (
		// You could have a loading skeleton as the `fallback` too
		<Suspense>
			<AuthWithReturnPath />
		</Suspense>
	);
};
