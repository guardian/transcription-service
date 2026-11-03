import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import {
	DynamoDBClient,
	GetItemCommand,
	PutItemCommand,
	DeleteItemCommand,
	UpdateItemCommand,
	type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import type { TranscriptionConfig } from '@guardian/transcription-service-backend-common';
import express from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import { GoogleAuth } from '../controllers/GoogleAuth';
import { initPassportAuth } from './passport';
import { createOAuthSession } from './oauthSession';

test('Passport validates DynamoDB-backed state across independent app instances', async (t) => {
	const previousExecutionEnv = process.env['AWS_EXECUTION_ENV'];
	process.env['AWS_EXECUTION_ENV'] = 'AWS_Lambda_nodejs24.x';
	t.after(() => {
		if (previousExecutionEnv === undefined)
			delete process.env['AWS_EXECUTION_ENV'];
		else process.env['AWS_EXECUTION_ENV'] = previousExecutionEnv;
	});
	const request = (url: string, options: RequestInit = {}) =>
		fetch(url, {
			...options,
			headers: { 'x-forwarded-proto': 'https', ...options.headers },
		});
	const config = {
		auth: { clientId: 'test', clientSecret: 'test' },
		app: {
			secret: 'test-secret',
			rootUrl: 'https://example.test',
			tableName: 'test',
		},
		aws: { region: 'eu-west-1' },
	} as TranscriptionConfig;
	const items = new Map<string, Record<string, AttributeValue>>();
	t.mock.method(
		DynamoDBClient.prototype,
		'send',
		async (
			command:
				| GetItemCommand
				| PutItemCommand
				| DeleteItemCommand
				| UpdateItemCommand,
		) => {
			if (command instanceof PutItemCommand) {
				items.set(
					command.input.Item!.id!.S!,
					structuredClone(command.input.Item!),
				);
				return {};
			}
			const key = command.input.Key!.id!.S!;
			if (command instanceof GetItemCommand) {
				assert.equal(command.input.ConsistentRead, true);
				return { Item: items.get(key) };
			}
			if (command instanceof UpdateItemCommand) {
				const expires = command.input.ExpressionAttributeValues![':e']!;
				const item = items.get(key);
				if (item) item.expires = expires;
				return { Attributes: { expires } };
			}
			items.delete(key);
			return {};
		},
	);
	initPassportAuth(config);
	// Stub only Google's network calls; use real Passport state verification.
	const strategy = (
		passport as unknown as {
			_strategy(name: string): {
				_oauth2: { getOAuthAccessToken: (...args: unknown[]) => void };
				userProfile: (...args: unknown[]) => void;
			};
		}
	)._strategy('google');
	let exchanges = 0;
	t.mock.method(
		strategy._oauth2,
		'getOAuthAccessToken',
		(
			_code: string,
			_options: unknown,
			done: (error: null, access: string, refresh: string) => void,
		) => {
			exchanges++;
			done(null, 'access', 'refresh');
		},
	);
	t.mock.method(
		strategy,
		'userProfile',
		(_token: string, done: (error: null, profile: unknown) => void) => {
			done(null, {
				email: 'user@guardian.co.uk',
				_json: { domain: 'guardian.co.uk', email: 'user@guardian.co.uk' },
			});
		},
	);
	const makeServer = () => {
		const app = express();
		app.use(passport.initialize());
		app.use('/api/auth', createOAuthSession(config));
		const auth = new GoogleAuth(config);
		app.get('/api/auth/google', ...auth.googleAuth());
		app.get('/api/auth/oauth-callback', ...auth.oauthCallback());
		return app.listen(0, '127.0.0.1');
	};
	const servers = [makeServer(), makeServer()];
	await Promise.all(servers.map((server) => once(server, 'listening')));
	const bases = servers.map((server) => {
		const address = server.address();
		assert(address && typeof address !== 'string');
		return `http://127.0.0.1:${address.port}`;
	});
	try {
		const begin = async () => {
			const response = await request(
				`${bases[0]}/api/auth/google?returnPath=/viewer&id=my-file`,
				{ redirect: 'manual' },
			);
			assert.equal(response.status, 302);
			const state = new URL(response.headers.get('location')!).searchParams.get(
				'state',
			)!;
			assert(state && !state.includes('my-file'));
			const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
			assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
			assert.match(response.headers.get('set-cookie')!, /Secure/);
			assert.match(response.headers.get('set-cookie')!, /SameSite=Lax/);
			return { state, cookie };
		};
		const callback = (state?: string, cookie?: string) =>
			request(
				`${bases[1]}/api/auth/oauth-callback?code=google-code${state === undefined ? '' : `&state=${encodeURIComponent(state)}`}`,
				{ redirect: 'manual', headers: cookie ? { cookie } : {} },
			);
		const login = await begin();
		const valid = await callback(login.state, login.cookie);
		assert.equal(valid.status, 302);
		const destination = new URL(valid.headers.get('location')!);
		assert.equal(destination.pathname, '/viewer');
		assert.equal(destination.searchParams.get('id'), 'my-file');
		assert.equal(
			(
				jwt.verify(
					destination.searchParams.get('auth')!,
					config.app.secret,
				) as jwt.JwtPayload
			).email,
			'user@guardian.co.uk',
		);
		assert.equal(items.size, 0);
		assert.equal((await callback(login.state, login.cookie)).status, 403);
		assert.equal((await callback(login.state)).status, 403);
		const missing = await begin();
		assert.equal((await callback(undefined, missing.cookie)).status, 403);
		const tampered = await begin();
		assert.equal(
			(await callback(`${tampered.state}tampered`, tampered.cookie)).status,
			403,
		);
		assert.equal((await callback(tampered.state, tampered.cookie)).status, 403);
		const first = await begin();
		const second = await begin();
		assert.equal((await callback(first.state, second.cookie)).status, 403);
		const expired = await begin();
		for (const item of items.values()) item.expires = { N: '0' };
		assert.equal((await callback(expired.state, expired.cookie)).status, 403);
		assert.equal(
			exchanges,
			1,
			'invalid state must fail before exchanging the code',
		);
	} finally {
		await Promise.all(
			servers.map(
				(server) =>
					new Promise<void>((resolve, reject) =>
						server.close((error) => (error ? reject(error) : resolve())),
					),
			),
		);
	}
});
