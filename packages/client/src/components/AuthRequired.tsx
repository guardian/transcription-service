import React, { Suspense } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';

const AuthWithReturnPath = () => {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const params = new URLSearchParams(searchParams?.toString());
	params.append('returnPath', pathname || '');

	return (
		<p className="text-gray-500 dark:text-gray-400 pt-3">
			<a
				href={`/api/auth/google?${params.toString()}`}
				className="font-medium text-blue-600 underline dark:text-blue-500 hover:no-underline"
			>
				Click here
			</a>{' '}
			to login with Google.
		</p>
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
