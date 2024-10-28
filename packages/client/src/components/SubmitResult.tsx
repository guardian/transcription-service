import { RequestStatus } from '@/types';
import { UploadProgress } from '@/components/UploadProgress';
import { UploadFailure } from '@/components/UploadFailure';
import { UploadSuccess } from '@/components/UploadSuccess';
import React from 'react';
import { MediaSourceType } from '@guardian/transcription-service-common';

export const SubmitResult = ({
	mediaSource,
	formStatus,
	mediaWithStatus,
	reset,
}: {
	mediaSource: MediaSourceType;
	formStatus: RequestStatus;
	mediaWithStatus: Record<string, RequestStatus>;
	reset: () => void;
}) => {
	const uploadsInProgress = Object.entries(mediaWithStatus).length > 0;
	const oneOrMoreUploadsFailed =
		formStatus === RequestStatus.Failed ||
		Object.values(mediaWithStatus).includes(RequestStatus.Failed);
	const allUploadsSucceeded =
		Object.entries(mediaWithStatus).length > 0 &&
		Object.values(mediaWithStatus).filter((s) => s !== RequestStatus.Success)
			.length === 0;
	return (
		<>
			{uploadsInProgress && (
				<UploadProgress uploads={mediaWithStatus} mediaSource={mediaSource} />
			)}
			{oneOrMoreUploadsFailed && (
				<UploadFailure reset={reset} mediaSource={mediaSource} />
			)}
			{allUploadsSucceeded && (
				<UploadSuccess reset={reset} mediaSource={mediaSource} />
			)}
		</>
	);
};
