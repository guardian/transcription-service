import React from 'react';

export const UploadSuccess = ({
	reset,
	mediaSource,
}: {
	reset: () => void;
	mediaSource: 'file' | 'url';
}) => {
	const mediaDownloadText = mediaSource === 'url' && (
		<p>
			The media at the url you submitted will first be downloaded, then
			transcribed. The download will take 5 minutes for a 1 hour video
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
				Transcription in progress - check your email for the completed
				transcript.{' '}
			</p>
			<div className="font-medium">
				{mediaDownloadText}
				<p>
					{' '}
					The transcription service can take a few minutes to start up, but
					thereafter the transcription process is typically shorter than the
					duration of the media file.{' '}
				</p>
				<p>
					If you have requested a translation, you will receive 2 emails: one
					for the transcription in the original language, another for the
					english translation. The emails will arrive at different times.
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
