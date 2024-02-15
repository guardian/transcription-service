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
	getDownloadSignedUrl,
	getSQSClient,
	sendMessage,
	isFailure,
	getObjectMetadata,
	SQSStatus,
} from '@guardian/transcription-service-backend-common';
import {
	SignedUrlQueryParams,
	inputBucketObjectMetadata,
} from '@guardian/transcription-service-common';
import type { SignedUrlResponseBody } from '@guardian/transcription-service-common';
import { APIGatewayProxyEvent, S3Event } from 'aws-lambda';

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

const handleS3Event = async (event: S3Event) => {
	const config = await getConfig();

	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);

	for (const record of event.Records) {
		const key = record.s3.object.key;
		console.log(`adding message to task queue for file ${key}`);
		const bucket = record.s3.bucket.name;
		const metaData = await getObjectMetadata(config.aws.region, bucket, key);

		const parsedMetadata = inputBucketObjectMetadata.safeParse(metaData);
		if (!parsedMetadata.success) {
			console.error(
				'S3 object creation handler was unable to parse object metadata',
				metaData,
			);
			return;
		}

		// create signed URL for worker to GET file
		const signedUrl = await getDownloadSignedUrl(
			config.aws.region,
			bucket,
			key,
			60,
		);
		// send message to queue
		const sendResult = await sendMessage(
			key,
			sqsClient,
			config.app.taskQueueUrl,
			config.app.transcriptionOutputBucket,
			config.aws.region,
			parsedMetadata.data['user-email'],
			parsedMetadata.data['file-name'],
			signedUrl,
		);
		if (sendResult.status == SQSStatus.Success) {
			console.log(`message for file ${key} added to task queue`);
		} else {
			console.error(
				`error sending message to task queue.\n error: ${sendResult.error} \nmessage:${sendResult.errorMsg}`,
			);
		}
	}
};

let handler;
if (runningOnAws) {
	console.log('Running on lambda');

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	handler = async (event: S3Event | APIGatewayProxyEvent, context: any) => {
		console.log('event', event);

		// Lambda has either been triggered by API Gateway or by a file being PUT
		// to the source media S3 bucket.
		if (isS3Event(event)) {
			console.log('handling s3 event');
			await handleS3Event(event);
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
