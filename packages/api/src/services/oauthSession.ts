import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { TranscriptionConfig } from '@guardian/transcription-service-backend-common';
import connectDynamoDB from 'connect-dynamodb';
import session from 'express-session';

const DynamoDBStore = connectDynamoDB(session);

// Passport's state: true recipe needs req.session, even with JWT login sessions.
// DynamoDB makes the OAuth handshake work across independent Lambda instances.
// https://www.passportjs.org/concepts/oauth2/authentication/
// https://www.passportjs.org/concepts/authentication/sessions/
export const createOAuthSession = (config: TranscriptionConfig) =>
	session({
		name: 'transcription-oauth-session',
		secret: config.app.secret,
		resave: false,
		saveUninitialized: false,
		// API Gateway terminates HTTPS before forwarding the request to Lambda.
		proxy: Boolean(process.env['AWS_EXECUTION_ENV']),
		cookie: {
			httpOnly: true,
			secure: new URL(config.app.rootUrl).protocol === 'https:',
			sameSite: 'lax',
			path: '/api/auth',
			maxAge: 10 * 60 * 1000,
		},
		store: new DynamoDBStore({
			client: new DynamoDBClient({
				...config.aws,
				...(config.dev?.localstackEndpoint
					? { endpoint: config.dev.localstackEndpoint }
					: {}),
			}),
			table: config.app.tableName,
			prefix: 'oauth-session:',
			// CDK manages the existing table and its expires TTL attribute.
			initialized: true,
		}),
	});
