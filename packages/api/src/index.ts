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
	writeTranscriptionItem,
} from '@guardian/transcription-service-backend-common';
import {
	ClientConfig,
	TranscriptExportRequest,
	inputBucketObjectMetadata,
	transcribeFileRequestBody,
	transcribeUrlRequestBody,
	MediaDownloadJob,
	CreateFolderRequest,
	signedUrlRequestBody,
	ExportStatus,
	ExportStatusRequest,
	ExportStatuses,
} from '@guardian/transcription-service-common';
import type { SignedUrlResponseBody } from '@guardian/transcription-service-common';
import {
	getDynamoClient,
	getTranscriptionItem,
} from '@guardian/transcription-service-backend-common/src/dynamodb';
import { createExportFolder, getDriveClients } from './services/googleDrive';
import { v4 as uuid4 } from 'uuid';
import {
	initializeExportStatuses,
	exportTranscriptToDoc,
	updateStatuses,
} from './export';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { invokeLambda } from './services/lambda';
import { LambdaClient } from '@aws-sdk/client-lambda';

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
	const dynamoClient: DynamoDBDocumentClient = getDynamoClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);
	const lambdaClient = new LambdaClient({ region: config.aws.region });

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
			if (!body.success) {
				logger.error('Failed to parse transcribe url request', body.error);
				res.status(422).send('Invalid request body');
				return;
			}
			if (!userEmail) {
				res.status(403).send('No user email property - is user loged in?');
				return;
			}
			const downloadJob: MediaDownloadJob = {
				id,
				url: body.data.url,
				languageCode: body.data.languageCode,
				translationRequested: body.data.translationRequested,
				diarizationRequested: body.data.diarizationRequested,
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
			logger.info('API successfully sent media download message to SQS', {
				id,
				url: body.data.url,
				userEmail,
				queue: config.app.mediaDownloadQueueUrl,
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
				config,
				userEmail,
				body.data.fileName,
				signedUrl,
				body.data.languageCode,
				body.data.translationRequested,
				body.data.diarizationRequested,
			);
			if (isSqsFailure(sendResult)) {
				res.status(500).send(sendResult.errorMsg);
				return;
			}
			logger.info('API successfully sent the message to SQS', {
				id: s3Key,
				filename: body.data.fileName,
				userEmail,
				gpuQueue: config.app.gpuTaskQueueUrl,
				taskQueue: config.app.taskQueueUrl,
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

	apiRouter.get('/export/status', [
		checkAuth,
		asyncHandler(async (req, res) => {
			const exportStatusRequest = ExportStatusRequest.safeParse(req.query);
			if (!exportStatusRequest.success) {
				res
					.status(400)
					.send(
						'Invalid request - you must provide the transcript id in the query string',
					);
				return;
			}
			const getItemResult = await getTranscriptionItem(
				dynamoClient,
				config.app.tableName,
				exportStatusRequest.data.id,
				{ check: true, currentUserEmail: req.user?.email },
			);
			if (getItemResult.status === 'failure') {
				res.status(getItemResult.statusCode).send(getItemResult.errorMessage);
				return;
			}
			res.send(JSON.stringify(getItemResult.item.exportStatuses));
			return;
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
			const getItemResult = await getTranscriptionItem(
				dynamoClient,
				config.app.tableName,
				createRequest.data.transcriptId,
				{ check: true, currentUserEmail: req.user?.email },
			);
			if (getItemResult.status === 'failure') {
				res.status(getItemResult.statusCode).send(getItemResult.errorMessage);
				return;
			}
			const driveClients = await getDriveClients(
				config,
				createRequest.data.oAuthTokenResponse,
			);
			const folderId = await createExportFolder(
				driveClients.drive,
				`${getItemResult.item.originalFilename} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
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
			const getItemResult = await getTranscriptionItem(
				dynamoClient,
				config.app.tableName,
				exportRequest.data.id,
				{ check: true, currentUserEmail: req.user?.email },
			);
			if (getItemResult.status === 'failure') {
				res.status(getItemResult.statusCode).send(getItemResult.errorMessage);
				return;
			}
			const driveClients = await getDriveClients(
				config,
				exportRequest.data.oAuthTokenResponse,
			);
			let exportStatuses: ExportStatuses = initializeExportStatuses(
				exportRequest.data.items,
			);
			await writeTranscriptionItem(dynamoClient, config.app.tableName, {
				...getItemResult.item,
				exportStatuses: exportStatuses,
			});

			exportStatuses = await Promise.all(
				exportStatuses.map((exportStatus: ExportStatus) => {
					if (exportStatus.exportType == 'source-media') {
						return exportStatus;
					}
					return exportTranscriptToDoc(
						config,
						s3Client,
						getItemResult.item,
						exportStatus.exportType,
						exportRequest.data.folderId,
						driveClients.drive,
						driveClients.docs,
					);
				}),
			);

			await writeTranscriptionItem(dynamoClient, config.app.tableName, {
				...getItemResult.item,
				exportStatuses: exportStatuses,
			});
			logger.info('Document exports complete.');

			try {
				await invokeLambda(
					lambdaClient,
					config.app.mediaExportFunctionName,
					JSON.stringify(exportRequest.data),
				);
			} catch (e) {
				const msg = 'Failed to invoke media export lambda';
				logger.error(msg, e);
				const mediaFailedStatus: ExportStatus = {
					status: 'failure',
					exportType: 'source-media',
					message: msg,
				};
				exportStatuses = updateStatuses(mediaFailedStatus, exportStatuses);
				await writeTranscriptionItem(dynamoClient, config.app.tableName, {
					...getItemResult.item,
					exportStatuses: updateStatuses(mediaFailedStatus, exportStatuses),
				});
			}
			res.send(JSON.stringify(exportStatuses));

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
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let serverlessExpressHandler: any;
	const serverlessHandler = getApp().then(
		(app) =>
			(serverlessExpressHandler = serverlessExpress({
				app,
			})),
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
