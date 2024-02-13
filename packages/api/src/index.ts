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
import { SignedUrlQueryParams } from '@guardian/transcription-service-common';
import type { SignedUrlResponseBody } from '@guardian/transcription-service-common';
import { APIGatewayProxyEvent, S3Event, S3EventRecord } from 'aws-lambda';

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
			);

			res.set('Cache-Control', 'no-cache');
			const responseBody: SignedUrlResponseBody = { presignedS3Url };
			res.send(responseBody);
		}),
	]);

	app.use('/api', apiRouter);

	if (runningOnAws) {
		app.use(express.static('client'));
		app.get('/*', (req, res) => {
			res.sendFile(path.resolve(__dirname, 'client', 'index.html'));
		});
	} else {
		if (emulateProductionLocally) {
			app.use(
				express.static(
					path.resolve(__dirname, '..', '..', '..', 'packages/client/out'),
				),
			);
			app.get('/*', (req: Request, res: Response) => {
				res.sendFile(
					path.resolve(
						__dirname,
						'..',
						'..',
						'..',
						'packages/client/out',
						'index.html',
					),
				);
			});
		}
	}

	return app;
};

const isS3Event = (event: S3Event | APIGatewayProxyEvent): event is S3Event =>
	'Records' in event;

let handler;
if (runningOnAws) {
	console.log('Running on lambda');

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	handler = async (event: S3Event | APIGatewayProxyEvent, context: any) => {
		console.log('event', event);
		// Lambda has either been triggered by API Gateway or by a file being PUT
		// to the source media S3 bucket.
		if (isS3Event(event)) {
			console.log('handle s3 event');
			event.Records.map((record: S3EventRecord) => {
				// log every k and v in record
				Object.entries(record).forEach(([key, value]) => {
					console.log(`${key}: ${value}`);
				});
			});
			return;
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let serverlessExpressHandler: any;
		const serverlessHandler = getApp().then(
			(app) => (serverlessExpressHandler = serverlessExpress({ app }).handler),
		);

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

export { handler };
