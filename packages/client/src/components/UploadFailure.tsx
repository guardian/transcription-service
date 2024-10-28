import React from 'react';
import { MediaSourceType } from '@guardian/transcription-service-common';

export const UploadFailure = ({
	reset,
	mediaSource,
}: {
	reset: () => void;
	mediaSource: MediaSourceType;
}) => {
	const text = mediaSource === 'file' ? 'uploads failed' : 'media urls invalid';
	return (
		<div
			className="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50 dark:bg-gray-800 dark:text-red-400"
			role="alert"
		>
			<span className="font-medium">One or more {text}</span>{' '}
			<button
				onClick={() => reset()}
				className="font-medium text-blue-600 underline dark:text-blue-500 hover:no-underline"
			>
				Click here
			</button>{' '}
			to try again
		</div>
	);
};
