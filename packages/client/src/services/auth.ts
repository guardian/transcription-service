import { AuthState, LoggedInUser } from '@/types';
import { BrowserHistory } from 'history';
import { jwtDecode } from 'jwt-decode';

export const initialState: AuthState = {
	token: undefined,
	loggedInUser: undefined,
};

export function isLoginExpired(token: string): boolean {
	const loggedInUser = jwtDecode(token) as LoggedInUser;
	// JWT expiry is epoch seconds, Date.now() is epoch millis
	console.log(`token will be expired at ${new Date(loggedInUser.exp * 1000)}`);
	return loggedInUser.exp * 1000 < Date.now();
}

export const initAuth = (browserHistory: BrowserHistory): AuthState => {
	const urlParams = new URLSearchParams(window.location.search);
	const maybeParameterToken = urlParams.get('auth');

	if (maybeParameterToken) {
		localStorage.setItem('transcription-auth', maybeParameterToken);
		urlParams.delete('auth');
		browserHistory.replace({
			search: `?${urlParams.toString()}`,
		});
	}

	const maybeToken =
		maybeParameterToken ?? localStorage.getItem('transcription-auth');

	if (maybeToken) {
		if (isLoginExpired(maybeToken)) {
			localStorage.removeItem('transcription-auth');
			return initialState;
		} else {
			return {
				loggedInUser: jwtDecode(maybeToken) as LoggedInUser,
				token: maybeToken,
			};
		}
	} else {
		return initialState;
	}
};

export function logOutIfLoginExpired(token: string | undefined) {
	if (token && isLoginExpired(token)) {
		logOut();
	}
}

export function logOut() {
	localStorage.removeItem('transcription-auth');
	window.location.href = '/';
}
