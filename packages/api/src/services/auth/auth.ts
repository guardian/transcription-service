import { jwtDecode } from 'jwt-decode';
import { NextFunction, Request, RequestHandler, Response } from 'express';

export const checkAuthToken = (auth: string | undefined) => {
	//const urlParams = new URLSearchParams(window.location.search);
	const maybeParameterToken = auth; //urlParams.get('auth');

	console.log(`maybeParameterToken: ${maybeParameterToken}`);

	if (maybeParameterToken) {
		//window.localStorage.setItem('transcription-auth', maybeParameterToken);
		//urlParams.delete('auth');
	}

	const maybeToken = maybeParameterToken; //?? window.localStorage.getItem('transcription-auth');

	console.log(`maybeToken: ${maybeToken}`);

	if (maybeToken) {
		if (isLoginExpired(maybeToken)) {
			//window.localStorage.removeItem('transcription-auth');
			console.log(`expired`);
			return false;
		} else {
			console.log(`token is valid`);
			return true;
		}
	}

	console.log(`no token found`);
	return false;
};

export type LoggedInUser = {
	email: string;
	exp: number; // Expiry for the JWT token, in epoch time
};

export function isLoginExpired(token: string): boolean {
	const loggedInUser = jwtDecode(token) as LoggedInUser;
	// JWT expiry is epoch seconds, Date.now() is epoch millis
	return loggedInUser.exp * 1000 < Date.now();
}

export const checkAuthenticated = (req: Request, res: Response, next: NextFunction) => {
	console.log("checking if user is authenticated")
	if (req.isAuthenticated()) {
		console.log("user is authenticated")
		return next() 
	}
	
	console.log(req.isAuthenticated())
	res.redirect("/login")
  }