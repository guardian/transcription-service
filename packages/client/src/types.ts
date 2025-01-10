export type LoggedInUser = {
	email: string;
	exp: number; // Expiry for the JWT token, in epoch time
};

export type AuthState = {
	token?: string;
	loggedInUser?: LoggedInUser;
};

export enum RequestStatus {
	Ready = 'Ready',
	InProgress = 'InProgress',
	Invalid = 'Invalid',
	Success = 'Success',
	Failed = 'Failed',
}

type MediaUrlInvalid = {
	status: 'invalid';
	value: string;
	reason: string;
};

type MediaUrlValid = {
	status: 'valid';
	value: string;
};

type MediaUrlEmpty = {
	status: 'empty';
	value: string;
};

export type MediaUrlInput = MediaUrlInvalid | MediaUrlValid | MediaUrlEmpty;
