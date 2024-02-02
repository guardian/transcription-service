import jwt from 'jsonwebtoken';
import passport from 'passport';
import { stringify } from 'qs';
import { URL } from 'url';
import { TranscriptionConfig } from '../config';
import { NextFunction, Request, RequestHandler, Response } from 'express';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Action = (...args: any[]) => RequestHandler[];

export const checkAuth = passport.authenticate('jwt', { session: false });

export class GoogleAuth {
	rootUrl: string;
	secret: string;

	constructor(config: TranscriptionConfig) {
		this.rootUrl = config.app.rootUrl;
		this.secret = config.app.secret;
	}

	googleAuth: Action = () => [
		(req: Request, res: Response, next: NextFunction) => {
			const { query } = req;
			const authenticator = passport.authenticate('google', {
				scope: ['email'],
				state: JSON.stringify(query),
				// we're going to manage this ourselves using JWT
				session: false,
			});
			authenticator(req, res, next);
		},
	];

	oauthCallback: Action = () => [
		passport.authenticate('google', {
			session: false,
		}),
		(req: Request, res: Response) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const { email } = req.user! as any;
			const { state } = req.query;
			const returnUrl = new URL(this.rootUrl);
			console.log(`user ${email} logged in`);

			// preserve query string and path from state
			if (typeof state === 'string') {
				const authState = JSON.parse(state);
				// path
				returnUrl.pathname = authState.returnPath;
				delete authState.returnPath; // remove returnPath from the object - we don't need it in the query string

				// query
				returnUrl.search = stringify(authState);
			}

			const token = jwt.sign({ email }, this.secret, {
				expiresIn: '1 week',
			});
			returnUrl.searchParams.set('auth', token);

			res.redirect(returnUrl.toString());
		},
	];
}

export type LoginEvent = {
	type: 'login';
	user: string;
};

export const createLoginEvent = (user: string): LoginEvent => {
	return {
		type: 'login',
		user,
	};
};
