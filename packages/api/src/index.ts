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
	getSignedUploadUrl,
	getSQSClient,
	generateOutputSignedUrlAndSendMessage,
	isFailure,
	getSignedDownloadUrl,
	getObjectMetadata,
	logger,
	getObjectText,
	getS3Client,
} from '@guardian/transcription-service-backend-common';
import {
	ClientConfig,
	TranscriptExportRequest,
	inputBucketObjectMetadata,
	sendMessageRequestBody,
} from '@guardian/transcription-service-common';
import type { SignedUrlResponseBody } from '@guardian/transcription-service-common';
import {
	getDynamoClient,
	getTranscriptionItem,
	TranscriptionDynamoItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import { createTranscriptDocument } from './services/googleDrive';
import { v4 as uuid4 } from 'uuid';

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

	const s3Client = getS3Client(config.aws.region);

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

	apiRouter.post('/transcribe-file', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const userEmail = req.user?.email;
			const body = sendMessageRequestBody.safeParse(req.body);
			if (!body.success || !userEmail) {
				res.status(422).send('missing request params');
				return;
			}

			// confirm that the current user uploaded the file with this key
			const s3Key = body.data.s3Key;
			const objectMetadata = await getObjectMetadata(
				config.aws.region,
				config.app.sourceMediaBucket,
				s3Key,
			);
			if (!objectMetadata) {
				res.status(404).send('missing s3 object metadata');
				logger.error('missing s3 object metadata');
				return;
			}
			const parsedObjectMetadata =
				inputBucketObjectMetadata.safeParse(objectMetadata);
			if (!parsedObjectMetadata.success) {
				res.status(404).send('missing s3 object metadata');
				logger.error('invalid s3 object metadata');
				return;
			}
			const uploadedBy = parsedObjectMetadata.data['user-email'];
			if (uploadedBy != userEmail) {
				logger.error(
					`s3 object uploaded by ${uploadedBy} does not belong to user ${userEmail}`,
				);
				res.status(404).send('missing s3 object metadata');
				return;
			}

			const signedUrl = await getSignedDownloadUrl(
				config.aws.region,
				config.app.sourceMediaBucket,
				s3Key,
				3600,
			);
			const sendResult = await generateOutputSignedUrlAndSendMessage(
				s3Key,
				sqsClient,
				config.app.taskQueueUrl,
				config.app.transcriptionOutputBucket,
				config.aws.region,
				userEmail,
				body.data.fileName,
				signedUrl,
			);
			if (isFailure(sendResult)) {
				res.status(500).send(sendResult.errorMsg);
				return;
			}
			logger.info('API successfully sent the message to SQS', {
				id: s3Key,
				filename: body.data.fileName,
				userEmail,
			});
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
				logger.error(msg);
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
				logger.error(msg);
				res.status(500).send(msg);
				return;
			}
			const parsedItem = TranscriptionDynamoItem.safeParse(item);
			if (!parsedItem.success) {
				const msg = `Failed to parse item ${exportRequest.data.id} from dynamodb. Error: ${parsedItem.error.message}`;
				logger.error(msg);
				res.status(500).send(msg);
				return;
			}
			if (parsedItem.data.userEmail !== req.user?.email) {
				// users can only export their own transcripts
				const msg = `User ${req.user?.email} does not have permission to export item with id ${parsedItem.data.id}`;
				console.error(msg);
				res.status(403).send(msg);
				return;
			}
			const transcriptText = await getObjectText(
				s3Client,
				config.app.transcriptionOutputBucket,
				parsedItem.data.transcriptKeys.text,
			);
			if (!transcriptText) {
				const msg = `Failed to export transcript - it is possible your transcript has expired. Please re-upload the file and try again.`;
				res.status(500).send(msg);
				return;
			}
			const exportResult = await createTranscriptDocument(
				config,
				`${parsedItem.data.originalFilename} transcript`,
				exportRequest.data.oAuthTokenResponse,
				transcriptText,
			);
			if (!exportResult) {
				const msg = `Failed to create google document for item with id ${parsedItem.data.id}`;
				logger.error(msg);
				res.status(500).send(msg);
				return;
			}
			res.send({
				documentId: exportResult,
			});
			return;
		}),
	]);

	apiRouter.get('/signed-url', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const s3Key = uuid4();
			const presignedS3Url = await getSignedUploadUrl(
				config.aws.region,
				config.app.sourceMediaBucket,
				req.user?.email ?? 'not found',
				60,
				true,
				s3Key,
			);

			res.set('Cache-Control', 'no-cache');
			const responseBody: SignedUrlResponseBody = { presignedS3Url, s3Key };
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
	logger.info('Running on lambda');

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
	logger.info('running locally');
	// Running locally. Start Express ourselves
	const port = 9103;
	getApp().then((app) => {
		app.listen(port, () => {
			logger.info(`Server now listening on port: ${port}`);
		});
	});
}

export { api };
