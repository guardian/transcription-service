import React from 'react';
import { RequestStatus } from '@/types';
import { Spinner } from 'flowbite-react';
import {
	CheckCircleIcon,
	ExclamationTriangleIcon,
} from '@heroicons/react/16/solid';

export const iconForStatus = (status: RequestStatus) => {
	switch (status) {
		case RequestStatus.InProgress:
			return <Spinner className={'w-6 h-6'} />;
		case RequestStatus.Failed:
			return <ExclamationTriangleIcon className={'w-6 h-6 text-red-500'} />;
		case RequestStatus.Success:
			return <CheckCircleIcon className={'w-6 h-6 text-green-500'} />;
		default:
			return null;
	}
};

export const InfoMessage = ({
	message,
	status,
}: {
	message: string;
	status: RequestStatus;
}) => {
	return (
		<div className={'flex space-x-3'}>
			{iconForStatus(status)}
			<p className={'mb-3 text-gray-500 dark:text-gray-400'}>{message}</p>
		</div>
	);
};
