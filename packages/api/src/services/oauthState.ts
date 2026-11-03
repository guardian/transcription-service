import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'transcription-oauth-state';
const MAX_AGE_SECONDS = 10 * 60;

export const createOAuthState = (secret: string, rootUrl: string) => {
	// Keep state tokens separate from the key used for API bearer tokens.
	const stateSecret = createHmac('sha256', secret)
		.update('transcription-service/oauth-state')
		.digest();
	const cookieOptions = {
		httpOnly: true,
		secure: new URL(rootUrl).protocol === 'https:',
		sameSite: 'lax' as const,
		path: '/api/auth',
	};

	const begin: RequestHandler = (req, res, next) => {
		const nonce = randomBytes(32).toString('hex');
		const state = jwt.sign({ nonce, query: req.query }, stateSecret, {
			algorithm: 'HS256',
			audience: 'oauth-state',
			expiresIn: MAX_AGE_SECONDS,
		});
		res.set('Cache-Control', 'no-store');
		res.cookie(COOKIE_NAME, nonce, {
			...cookieOptions,
			maxAge: MAX_AGE_SECONDS * 1000,
		});
		res.locals.oauthState = state;
		next();
	};

	const verify: RequestHandler = (req, res, next) => {
		res.set('Cache-Control', 'no-store');
		// Consume the browser's pending login even when verification fails.
		res.clearCookie(COOKIE_NAME, cookieOptions);
		try {
			if (typeof req.query.state !== 'string') throw new Error('Missing state');
			const payload = jwt.verify(req.query.state, stateSecret, {
				algorithms: ['HS256'],
				audience: 'oauth-state',
			});
			const cookies = (req.headers.cookie ?? '')
				.split(';')
				.map((cookie) => cookie.trim())
				.filter((cookie) => cookie.startsWith(`${COOKIE_NAME}=`));
			const nonce = cookies[0]?.slice(COOKIE_NAME.length + 1);
			if (
				cookies.length !== 1 ||
				!nonce ||
				typeof payload === 'string' ||
				typeof payload.nonce !== 'string' ||
				!/^[a-f0-9]{64}$/.test(nonce) ||
				!/^[a-f0-9]{64}$/.test(payload.nonce) ||
				!timingSafeEqual(Buffer.from(nonce), Buffer.from(payload.nonce)) ||
				!payload.query ||
				typeof payload.query !== 'object' ||
				Array.isArray(payload.query)
			) {
				throw new Error('Invalid state');
			}
			// The callback only reads return navigation from authenticated state.
			res.locals.oauthReturnQuery = payload.query;
		} catch {
			res
				.status(403)
				.send('Invalid or expired login state. Please start login again.');
			return;
		}
		next();
	};

	return { begin, verify };
};
