import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid4 } from 'uuid';
import {
	getObjectMetadata,
	getSignedDownloadUrl,
	getSignedUploadUrl,
	isSqsFailure,
	sendMessage,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { getOcrItem } from '@guardian/transcription-service-backend-common/src/dynamodb';
import {
	DestinationService,
	OcrJob,
	OcrRequestBody,
	OcrResult,
	ONE_WEEK_IN_SECONDS,
} from '@guardian/transcription-service-common';

export const createOcrRouter = (
	config: TranscriptionConfig,
	sqsClient: SQSClient,
	dynamoClient: DynamoDBDocumentClient,
) => {
	const router = Router();
	router.post(
		'/',
		asyncHandler(async (req, res) => {
			const userEmail = req.user?.email;
			if (!userEmail) {
				res.status(403).send('Login required');
				return;
			}
			const body = OcrRequestBody.safeParse(req.body);
			if (!body.success) {
				res
					.status(422)
					.send('Invalid OCR request: provide a PDF and OCR language code');
				return;
			}
			const { s3Key, fileName, ocrLanguage } = body.data;
			const metadata = await getObjectMetadata(
				config.aws,
				config.app.sourceMediaBucket,
				s3Key,
			);
			if (metadata?.['user-email'] !== userEmail) {
				res.status(404).send('Uploaded file not found');
				return;
			}
			const id = uuid4();
			const outputKey = `${id}-ocr-output.json`;
			const job: OcrJob = {
				id,
				jobType: 'ocr',
				originalFilename: fileName,
				userEmail,
				sentTimestamp: new Date().toISOString(),
				transcriptDestinationService: DestinationService.TranscriptionService,
				inputSignedUrl: await getSignedDownloadUrl(
					config.aws,
					config.app.sourceMediaBucket,
					s3Key,
					ONE_WEEK_IN_SECONDS,
				),
				combinedOutputUrl: {
					key: outputKey,
					url: await getSignedUploadUrl(
						config.aws,
						config.app.transcriptionOutputBucket,
						userEmail,
						ONE_WEEK_IN_SECONDS,
						false,
						outputKey,
					),
				},
				settings: { ocrLanguage },
			};
			const result = await sendMessage(
				sqsClient,
				config.app.gpuTaskQueueUrl,
				JSON.stringify(job),
				id,
			);
			if (isSqsFailure(result)) {
				res.status(500).send('Failed to queue OCR job');
				return;
			}
			res.json({ id });
		}),
	);
	router.get(
		'/',
		asyncHandler(async (req, res) => {
			const userEmail = req.user?.email;
			if (!userEmail) {
				res.status(403).send('Login required');
				return;
			}
			const id = req.query.id;
			if (typeof id !== 'string' || !id) {
				res.status(400).send('Missing required query parameter: id');
				return;
			}
			res.set('Cache-Control', 'no-store');
			const item = await getOcrItem(
				dynamoClient,
				config.app.tableName,
				id,
				userEmail,
			);
			if (!item) {
				res.status(404).send('OCR result not found');
				return;
			}
			const result: OcrResult =
				item.status === 'OCR_FAILURE'
					? { status: item.status, errorMessage: item.errorMessage }
					: {
							status: item.status,
							downloadUrl: await getSignedDownloadUrl(
								config.aws,
								config.app.transcriptionOutputBucket,
								item.outputKey,
								ONE_WEEK_IN_SECONDS,
								`${id}.ocr.pdf`,
							),
						};
			res.json(result);
		}),
	);
	return router;
};
