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
	isSqsFailure,
	getSignedDownloadUrl,
	getObjectMetadata,
	logger,
	getS3Client,
	sendMessage,
} from '@guardian/transcription-service-backend-common';
import {
	ClientConfig,
	TranscriptExportRequest,
	inputBucketObjectMetadata,
	transcribeFileRequestBody,
	transcribeUrlRequestBody,
	MediaDownloadJob,
	CreateFolderRequest,
	ExportResponse,
	signedUrlRequestBody,
} from '@guardian/transcription-service-common';
import type { SignedUrlResponseBody } from '@guardian/transcription-service-common';
import {
	getDynamoClient,
	getTranscriptionItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import { createExportFolder, getDriveClients } from './services/googleDrive';
import { v4 as uuid4 } from 'uuid';
import { exportMediaToDrive, exportTranscriptToDoc } from './export';

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
	const dynamoClient = getDynamoClient(
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

	apiRouter.post('/transcribe-url', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const userEmail = req.user?.email;
			const body = transcribeUrlRequestBody.safeParse(req.body);
			const id = uuid4();
			if (!body.success || !userEmail) {
				res.status(422).send('missing request params');
				return;
			}
			const downloadJob: MediaDownloadJob = {
				id,
				url: body.data.url,
				languageCode: body.data.languageCode,
				translationRequested: body.data.translationRequested,
				userEmail,
			};

			const sendResult = await sendMessage(
				sqsClient,
				config.app.mediaDownloadQueueUrl,
				JSON.stringify(downloadJob),
				id,
			);
			if (isSqsFailure(sendResult)) {
				res.status(500).send(sendResult.errorMsg);
				return;
			}
			logger.info('API successfully sent the message to SQS', {
				id,
				url: body.data.url,
				userEmail,
			});
			res.send('Message sent');
		}),
	]);

	apiRouter.post('/transcribe-file', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const userEmail = req.user?.email;
			const body = transcribeFileRequestBody.safeParse(req.body);
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
				604800, // one week in seconds
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
				body.data.languageCode,
				body.data.translationRequested,
			);
			if (isSqsFailure(sendResult)) {
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

	apiRouter.post('/export/create-folder', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const createRequest = CreateFolderRequest.safeParse(req.body);
			if (!createRequest.success) {
				const msg = `Failed to parse create folder request ${createRequest.error.message}`;
				logger.error(msg);
				res.status(400).send(msg);
				return;
			}
			const { item, errorMessage } = await getTranscriptionItem(
				dynamoClient,
				config.app.tableName,
				createRequest.data.transcriptId,
			);
			if (!item) {
				res.status(500).send(errorMessage);
				return;
			}
			const driveClients = await getDriveClients(
				config,
				createRequest.data.oAuthTokenResponse,
			);
			const folderId = await createExportFolder(
				driveClients.drive,
				item.originalFilename,
			);
			if (!folderId) {
				res.status(500).send('Failed to create folder');
				return;
			}
			res.send(folderId);
		}),
	]);

	apiRouter.post('/export/export', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const exportRequest = TranscriptExportRequest.safeParse(req.body);
			if (!exportRequest.success) {
				const msg = `Failed to parse export request ${exportRequest.error.message}`;
				logger.error(msg);
				res.status(400).send(msg);
				return;
			}
			const { item, errorMessage } = await getTranscriptionItem(
				dynamoClient,
				config.app.tableName,
				exportRequest.data.id,
			);
			if (!item) {
				res.status(500).send(errorMessage);
				return;
			}
			if (item.userEmail !== req.user?.email) {
				// users can only export their own transcripts. Return a 404 to avoid leaking information about other users' transcripts
				logger.warn(
					`User ${req.user?.email} attempted to export transcript ${item.id} which does not belong to them.`,
				);
				res.status(404).send(`Transcript not found`);
				return;
			}
			const driveClients = await getDriveClients(
				config,
				exportRequest.data.oAuthTokenResponse,
			);
			const exportResult: ExportResponse = {
				textDocumentId: undefined,
				srtDocumentId: undefined,
				sourceMediaFileId: undefined,
			};
			if (exportRequest.data.items.transcriptText) {
				const textResult = await exportTranscriptToDoc(
					config,
					s3Client,
					item,
					'text',
					exportRequest.data.folderId,
					driveClients.drive,
					driveClients.docs,
				);
				if (textResult.statusCode !== 200) {
					res.status(textResult.statusCode).send(textResult.message);
					return;
				}
				exportResult.textDocumentId = textResult.documentId;
			}
			if (exportRequest.data.items.transcriptSrt) {
				const srtResult = await exportTranscriptToDoc(
					config,
					s3Client,
					item,
					'srt',
					exportRequest.data.folderId,
					driveClients.drive,
					driveClients.docs,
				);
				if (srtResult.statusCode !== 200) {
					res.status(srtResult.statusCode).send(srtResult.message);
					return;
				}
				exportResult.srtDocumentId = srtResult.documentId;
			}
			if (exportRequest.data.items.sourceMedia) {
				const mediaResult = await exportMediaToDrive(
					config,
					s3Client,
					item,
					exportRequest.data.oAuthTokenResponse,
					exportRequest.data.folderId,
				);
				if (mediaResult.statusCode !== 200) {
					logger.error('Failed to export media to google drive');
					res.status(mediaResult.statusCode).send(mediaResult.message);
					return;
				}
				exportResult.sourceMediaFileId = mediaResult.fileId;
			}
			res.send(JSON.stringify(exportResult));
			return;
		}),
	]);

	apiRouter.post('/signed-url', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const parsedRequest = signedUrlRequestBody.safeParse(req.body);
			if (!parsedRequest.success) {
				res.status(400).send('Invalid request');
				return;
			}

			const s3Key = uuid4();
			const presignedS3Url = await getSignedUploadUrl(
				config.aws.region,
				config.app.sourceMediaBucket,
				req.user?.email ?? 'not found',
				60,
				true,
				s3Key,
				parsedRequest.data.fileName,
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
		(app) => (serverlessExpressHandler = serverlessExpress({ app })),
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
