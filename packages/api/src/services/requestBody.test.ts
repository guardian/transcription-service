import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import type { TranscriptionConfig } from '@guardian/transcription-service-backend-common';
import { checkAuth, initPassportAuth } from './passport';
import { smallJson, llmJson } from './requestBody';

test('authenticated JSON parsers enforce size and encoding limits', async (t) => {
	const secret = 'request-body-test-secret';
	initPassportAuth({
		auth: { clientId: 'test', clientSecret: 'test' },
		app: { rootUrl: 'https://example.test', secret },
	} as TranscriptionConfig);
	const app = express();
	app.use(passport.initialize());
	app.post('/small', checkAuth, smallJson, (req, res) => res.json(req.body));
	app.post('/llm', checkAuth, llmJson, (req, res) => res.json(req.body));
	app.get('/get', checkAuth, (_req, res) => res.sendStatus(204));
	const reportError: ErrorRequestHandler = (error, _req, res, next) => {
		if (res.headersSent) {
			next(error);
			return;
		}
		res.sendStatus(error.status ?? 500);
	};
	app.use(reportError);
	const server = app.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(
		() =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	);
	const address = server.address();
	assert(address && typeof address !== 'string');
	const base = `http://127.0.0.1:${address.port}`;
	const authorization = `Bearer ${jwt.sign({ email: 'user@example.test' }, secret, { expiresIn: '5m' })}`;
	const post = (
		route: string,
		body: string | Buffer,
		authenticated = true,
		compressed = false,
	) =>
		fetch(`${base}${route}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(authenticated ? { authorization } : {}),
				...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
			},
			body,
		});
	const small = JSON.stringify({ fileName: 'interview.mp3' });
	const prompt = JSON.stringify({
		prompt: { user: 'x'.repeat(150 * 1024) },
		backend: 'BEDROCK',
	});
	const oversized = JSON.stringify({
		prompt: { user: 'x'.repeat(2 * 1024 * 1024) },
	});
	for (const route of ['/small', '/llm']) {
		await t.test(`${route} authenticates before parsing`, async () => {
			for (const body of ['{', oversized, gzipSync(small)]) {
				const response = await post(route, body, false, Buffer.isBuffer(body));
				assert.equal(response.status, 401);
				await response.text();
			}
		});
		await t.test(
			`${route} rejects invalid, oversized and compressed JSON`,
			async () => {
				for (const [body, status, compressed] of [
					['{', 400, false],
					[oversized, 413, false],
					[gzipSync(small), 415, true],
				] as const) {
					const response = await post(route, body, true, compressed);
					assert.equal(response.status, status);
					await response.text();
				}
			},
		);
	}
	const controlResponse = await post('/small', small);
	assert.equal(controlResponse.status, 200);
	assert.deepEqual(await controlResponse.json(), JSON.parse(small));
	const tooLargeForControl = await post('/small', prompt);
	assert.equal(tooLargeForControl.status, 413);
	await tooLargeForControl.text();
	const promptResponse = await post('/llm', prompt);
	assert.equal(promptResponse.status, 200);
	assert.deepEqual(await promptResponse.json(), JSON.parse(prompt));
	assert.equal(
		(await fetch(`${base}/get`, { headers: { authorization } })).status,
		204,
	);
});
