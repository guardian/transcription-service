import React from 'react';
import { MediaSourceType } from '@guardian/transcription-service-common';

export const UploadSuccess = ({
	reset,
	mediaSource,
}: {
	reset: () => void;
	mediaSource: MediaSourceType;
}) => {
	const mediaDownloadText = mediaSource === 'url' && (
		<p>
			The media at the URL you submitted will first be downloaded, then
			transcribed. The download will take five minutes for a one-hour video
		</p>
	);
	const completeText =
		mediaSource === 'url' ? 'Urls submitted' : 'Upload complete.';
	return (
		<div
			className="p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50 dark:bg-gray-800 dark:text-green-400"
			role="alert"
		>
			<span className="font-medium">{completeText} </span>{' '}
			<p>
				Transcription in progress. Check your email for the completed
				transcript.{' '}
			</p>
			<div className="font-medium">
				{mediaDownloadText}
				<p>
					{' '}
					The transcription process is typically shorter than the duration of
					the media file.{' '}
				</p>
				<p>
					English translations are now included in the same email as the
					transcript in the original language.
				</p>
			</div>
			<button
				onClick={() => reset()}
				className="font-medium text-blue-600 underline dark:text-blue-500 hover:no-underline"
			>
				Click here
			</button>{' '}
			to transcribe another file
		</div>
	);
};
