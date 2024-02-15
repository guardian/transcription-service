import express from 'express';
import asyncHandler from 'express-async-handler';
import serverlessExpress from '@codegenie/serverless-express';
import bodyParser from 'body-parser';
import path from 'path';
import { checkAuth, initPassportAuth } from './services/passport';
import { GoogleAuth } from './controllers/GoogleAuth';
import passport from 'passport';
import { Request, Response } from 'express';
import {
	getConfig,
	getSignedUrl,
	getSQSClient,
	sendMessage,
	isFailure,
} from '@guardian/transcription-service-backend-common';
import {
	ClientConfig,
	SignedUrlQueryParams,
	TranscriptExportRequest,
} from '@guardian/transcription-service-common';
import type { SignedUrlResponseBody } from '@guardian/transcription-service-common';
import {
	getDynamoClient,
	getTranscriptionItem,
	TranscriptionItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import { createTranscriptDocument } from './services/googleDrive';

const runningOnAws = process.env['AWS_EXECUTION_ENV'];
const emulateProductionLocally =
	process.env['EMULATE_PRODUCTION_SERVER'] === 'true';

const getApp = async () => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const config = await getConfig();

	const app = express();
	const apiRouter = express.Router();

	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);

	app.use(bodyParser.json({ limit: '40mb' }));
	app.use(passport.initialize());

	// auth
	initPassportAuth(config);
	const auth = new GoogleAuth(config);
	apiRouter.get('/auth/google', ...auth.googleAuth());
	apiRouter.get('/auth/oauth-callback', ...auth.oauthCallback());

	// checkAuth is the pattern of checking auth
	// for every api endpoint that's added
	apiRouter.get('/healthcheck', [
		checkAuth,
		asyncHandler(async (req, res) => {
			res.send('It lives!');
		}),
	]);

	apiRouter.post('/send-message', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const userEmail = 'digital.investigations@theguardian.com';
			const originalFilename = 'test.mp3';
			const id = 'my-first-transcription';
			const signedUrl = 'tifsample.wav';
			const sendResult = await sendMessage(
				id,
				sqsClient,
				config.app.taskQueueUrl,
				config.app.transcriptionOutputBucket,
				config.aws.region,
				userEmail,
				originalFilename,
				signedUrl,
			);
			if (isFailure(sendResult)) {
				res.status(500).send(sendResult.errorMsg);
				return;
			}
			res.send('Message sent');
		}),
	]);

	apiRouter.get('/client-config', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const clientConfig: ClientConfig = {
				googleClientId: config.auth.clientId,
			};
			res.send(JSON.stringify(clientConfig));
		}),
	]);

	apiRouter.post('/export', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const exportRequest = TranscriptExportRequest.safeParse(req.body);
			const dynamoClient = getDynamoClient(
				config.aws.region,
				config.aws.localstackEndpoint,
			);
			if (!exportRequest.success) {
				const msg = `Failed to parse export request ${exportRequest.error.message}`;
				console.error(msg);
				res.status(400).send(msg);
				return;
			}
			const item = await getTranscriptionItem(
				dynamoClient,
				config.app.tableName,
				exportRequest.data.id,
			);
			if (!item) {
				const msg = `Failed to fetch item with id ${exportRequest.data.id} from database.`;
				console.error(msg);
				res.status(500).send(msg);
				return;
			}
			const parsedItem = TranscriptionItem.safeParse(item);
			if (!parsedItem.success) {
				const msg = `Failed to parse item ${exportRequest.data.id} from dynamodb. Error: ${parsedItem.error.message}`;
				console.error(msg);
				res.status(500).send(msg);
				return;
			}
			const exportResult = await createTranscriptDocument(
				config,
				`${parsedItem.data.originalFilename} transcript`,
				exportRequest.data.oAuthTokenResponse,
				parsedItem.data.transcripts.srt,
			);
			if (!exportResult) {
				const msg = `Failed to create google document for item with id ${parsedItem.data.id}`;
				console.error(msg);
				res.status(500).send(msg);
				return;
			}
			res.send({
				documentId: exportResult,
			});
			return;
		}),
	]);

	apiRouter.get('/signedUrl', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const queryParams = SignedUrlQueryParams.safeParse(req.query);
			if (!queryParams.success) {
				res.status(422).send('missing query parameters');
				return;
			}
			const presignedS3Url = await getSignedUrl(
				config.aws.region,
				config.app.sourceMediaBucket,
				req.user?.email ?? 'not found',
				queryParams.data.fileName,
				60,
				true,
			);

			res.set('Cache-Control', 'no-cache');
			const responseBody: SignedUrlResponseBody = { presignedS3Url };
			res.send(responseBody);
		}),
	]);

	app.use('/api', apiRouter);

	const clientPages = ['export'];

	if (runningOnAws) {
		app.use(express.static('client'));
		app.get('/:page', (req, res) => {
			if (req.params.page && !clientPages.includes(req.params.page)) {
				res
					.status(404)
					.send(
						`Endpoint not supported. Valid endpoints: /, /${clientPages.join(', /')}`,
					);
			}
			const page = req.params.page ? `${req.params.page}.html` : 'index.html';
			res.sendFile(path.resolve(__dirname, 'client', page));
		});
	} else {
		if (emulateProductionLocally) {
			app.use(
				express.static(
					path.resolve(__dirname, '..', '..', '..', 'packages/client/out'),
				),
			);
			app.get('/:page', (req: Request, res: Response) => {
				const page = req.params.page ? `${req.params.page}.html` : 'index.html';
				res.sendFile(
					path.resolve(
						__dirname,
						'..',
						'..',
						'..',
						'packages/client/out',
						page,
					),
				);
			});
		}
	}

	return app;
};

let api;
if (runningOnAws) {
	console.log('Running on lambda');

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let serverlessExpressHandler: any;
	const serverlessHandler = getApp().then(
		(app) => (serverlessExpressHandler = serverlessExpress({ app }).handler),
	);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	api = async (event: any, context: any) => {
		if (!serverlessExpressHandler) {
			await serverlessHandler;
		}
		return serverlessExpressHandler(event, context);
	};
} else {
	console.log('running locally');
	// Running locally. Start Express ourselves
	const port = 9103;
	getApp().then((app) => {
		app.listen(port, () => {
			console.log(`Server now listening on port: ${port}`);
		});
	});
}

export { api };
