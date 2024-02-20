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
	Success = 'Success',
	Failed = 'Failed',
}
