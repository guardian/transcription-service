import { iconForStatus } from '@/components/InfoMessage';
import React from 'react';
import { RequestStatus } from '@/types';
import { MediaSourceType } from '@guardian/transcription-service-common';

export const UploadProgress = ({
	uploads,
	mediaSource,
}: {
	uploads: Record<string, RequestStatus>;
	mediaSource: MediaSourceType;
}) => {
	const text =
		mediaSource === 'file' ? 'Uploading files:' : 'Processing media urls:';
	return (
		<div className={'pb-10'}>
			<h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
				{text}
			</h2>

			<ul className="max-w-md space-y-2 text-gray-500 list-inside dark:text-gray-400">
				{Object.entries(uploads).map(([key, value]) => (
					<li className="flex items-center">
						<span className={'mr-1'}>{iconForStatus(value)}</span>
						{key} {value === RequestStatus.Invalid && ' (invalid url)'}
					</li>
				))}
			</ul>
		</div>
	);
};
