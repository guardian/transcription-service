import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createHmac } from 'node:crypto';
import { createOAuthState } from './oauthState';

test('OAuth state binds navigation to the initiating browser and expires', async () => {
	const secret = 'test-secret';
	const state = createOAuthState(secret, 'https://example.test');
	const app = express();
	app.get('/begin', state.begin, (_req, res) =>
		res.json({ state: res.locals.oauthState }),
	);
	app.get('/callback', state.verify, (_req, res) =>
		res.json(res.locals.oauthReturnQuery),
	);
	const server = app.listen(0, '127.0.0.1');
	await once(server, 'listening');
	try {
		const address = server.address();
		assert(address && typeof address !== 'string');
		const base = `http://127.0.0.1:${address.port}`;
		const begin = await fetch(`${base}/begin?returnPath=/viewer&id=my-file`);
		const token = (await begin.json()).state;
		const setCookie = begin.headers.get('set-cookie')!;
		assert.match(setCookie, /HttpOnly/);
		assert.match(setCookie, /Secure/);
		assert.match(setCookie, /SameSite=Lax/);
		const cookie = setCookie.split(';')[0]!;
		const callback = (value: string, browserCookie?: string) =>
			fetch(`${base}/callback?state=${encodeURIComponent(value)}`, {
				headers: browserCookie ? { cookie: browserCookie } : {},
			});
		const valid = await callback(token, cookie);
		assert.equal(valid.status, 200);
		assert.deepEqual(await valid.json(), {
			returnPath: '/viewer',
			id: 'my-file',
		});
		assert.match(valid.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
		// A browser applies the clearing cookie before any subsequent callback.
		assert.equal((await callback(token)).status, 403);
		assert.equal(
			(await fetch(`${base}/callback`, { headers: { cookie } })).status,
			403,
		);
		assert.equal((await callback(`${token}tampered`, cookie)).status, 403);
		const other = await fetch(`${base}/begin`);
		const otherCookie = other.headers.get('set-cookie')!.split(';')[0]!;
		assert.equal((await callback(token, otherCookie)).status, 403);
		const stateSecret = createHmac('sha256', secret)
			.update('transcription-service/oauth-state')
			.digest();
		const expired = jwt.sign(
			{ nonce: cookie.split('=')[1], query: {} },
			stateSecret,
			{
				audience: 'oauth-state',
				expiresIn: -1,
			},
		);
		assert.equal((await callback(expired, cookie)).status, 403);
		assert.throws(() => jwt.verify(token, secret));
	} finally {
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
	}
});
