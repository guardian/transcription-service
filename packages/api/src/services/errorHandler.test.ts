import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import asyncHandler from 'express-async-handler';
import { logger } from '@guardian/transcription-service-backend-common';
import { errorHandler } from './errorHandler';

test('request errors retain their status without exposing details, even in development', async (t) => {
	const log = t.mock.method(logger, 'error', () => {});
	const app = express();
	app.set('env', 'development');
	app.use(express.json({ limit: '1kb' }));
	const failure = new Error('secret database connection details');
	app.get('/sync', () => {
		throw failure;
	});
	app.get(
		'/async',
		asyncHandler(async () => {
			throw failure;
		}),
	);
	app.get('/status', (_req, _res, next) => {
		next(Object.assign(new Error('private details'), { statusCode: 403 }));
	});
	app.get('/invalid-status', (_req, _res, next) => {
		next({ status: 200, message: 'private details' });
	});
	app.use(errorHandler);
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
	for (const [route, status, message, body] of [
		['/sync', 500, 'Internal Server Error', undefined],
		['/async', 500, 'Internal Server Error', undefined],
		['/status', 403, 'Forbidden', undefined],
		['/invalid-status', 500, 'Internal Server Error', undefined],
		['/json', 400, 'Bad Request', '{'],
		[
			'/json',
			413,
			'Payload Too Large',
			JSON.stringify({ value: 'x'.repeat(2000) }),
		],
	] as const) {
		const response = await fetch(
			`${base}${route}`,
			body === undefined
				? {}
				: {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body,
					},
		);
		assert.equal(response.status, status);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.deepEqual(await response.json(), { error: message });
	}
	assert.equal(log.mock.callCount(), 6);
	assert.equal(log.mock.calls[0]?.arguments[1], failure);
});

test('errors after headers have been sent are delegated without writing a response', (t) => {
	t.mock.method(logger, 'error', () => {});
	const failure = new Error('stream failed');
	let delegated: unknown;
	errorHandler(
		failure,
		{} as express.Request,
		{ headersSent: true } as express.Response,
		(error: unknown) => {
			delegated = error;
		},
	);
	assert.equal(delegated, failure);
});
