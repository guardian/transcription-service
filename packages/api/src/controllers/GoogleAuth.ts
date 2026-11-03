import jwt from 'jsonwebtoken';
import passport from 'passport';
import { stringify } from 'qs';
import { URL } from 'url';
import {
	logger,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
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
			res.set('Cache-Control', 'no-store');
			req.session.oauthReturnQuery = req.query;
			const authenticator = passport.authenticate('google', {
				scope: ['email'],
				// we're going to manage this ourselves using JWT
				session: false,
			});
			authenticator(req, res, next);
		},
	];

	oauthCallback: Action = () => [
		(_req: Request, res: Response, next: NextFunction) => {
			res.set('Cache-Control', 'no-store');
			next();
		},
		passport.authenticate('google', {
			session: false,
		}),
		(req: Request, res: Response, next: NextFunction) => {
			res.locals.oauthReturnQuery = req.session.oauthReturnQuery;
			// The session is only needed for the OAuth handshake.
			res.clearCookie('transcription-oauth-session', { path: '/api/auth' });
			req.session.destroy(next);
		},
		(req: Request, res: Response) => {
			const email = req.user?.email;
			const returnUrl = new URL(this.rootUrl);
			logger.info(`user ${email} logged in`);

			// preserve query string and path from state
			if (res.locals.oauthReturnQuery) {
				const authState = res.locals.oauthReturnQuery;
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
