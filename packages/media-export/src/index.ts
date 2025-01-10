import { Handler } from 'aws-lambda';
// import {
// 	downloadObject,
// 	getConfig,
// 	getDynamoClient,
// 	getObjectSize,
// 	getTranscriptionItem,
// 	logger,
// 	TranscriptionConfig,
// 	TranscriptionDynamoItem,
// } from '@guardian/transcription-service-backend-common';
// import { S3Client } from '@aws-sdk/client-s3';
// import {
// 	ExportStatus,
// 	ZTokenResponse,
// } from '@guardian/transcription-service-common';
// import { LAMBDA_MAX_EPHEMERAL_STORAGE_BYTES } from '@guardian/transcription-service-backend-common/src/lambda';
// import { uploadFileToGoogleDrive } from 'api/src/services/googleDrive';

// export const exportMediaToDrive = async (
// 	config: TranscriptionConfig,
// 	s3Client: S3Client,
// 	item: TranscriptionDynamoItem,
// 	oAuthTokenResponse: ZTokenResponse,
// 	folderId: string,
// ): Promise<ExportStatus> => {
// 	logger.info(`Starting source media export`);
// 	const mediaSize = await getObjectSize(
// 		s3Client,
// 		config.app.sourceMediaBucket,
// 		item.id,
// 	);
// 	if (mediaSize && mediaSize > LAMBDA_MAX_EPHEMERAL_STORAGE_BYTES) {
// 		const msg = `Media file too large to export to google drive. Please manually download the file and upload using the google drive UI`;
// 		return {
// 			exportType: 'source-media',
// 			status: 'failure',
// 			message: msg,
// 		};
// 	}
// 	const filePath = `/tmp/${item.id.replace('/', '_')}`;
// 	const extension = await downloadObject(
// 		s3Client,
// 		config.app.sourceMediaBucket,
// 		item.id,
// 		filePath,
// 	);
//
// 	const mimeType = 'application/octet-stream';
//
// 	// default to mp4 on the assumption that most media exported will be video
// 	const extensionOrMp4 = extension || 'mp4';
//
// 	const fileName = item.originalFilename.endsWith(`.${extensionOrMp4}`)
// 		? item.originalFilename
// 		: `${item.originalFilename}.${extensionOrMp4 || 'mp4'}`;
//
// 	const id = await uploadFileToGoogleDrive(
// 		fileName,
// 		oAuthTokenResponse,
// 		filePath,
// 		mimeType,
// 		folderId,
// 	);
// 	logger.info(`Source media export complete, file id: ${id}`);
// 	return {
// 		exportType: 'source-media',
// 		id,
// 		status: 'success',
// 	};
// };
//
// const processExport = async (event: unknown) => {
// 	const config = await getConfig();
// 	const s3Client = new S3Client({});
//
// 	const dynamoClient = getDynamoClient(
// 		config.aws.region,
// 		config.aws.localstackEndpoint,
// 	);
// 	const { item, errorMessage } = await getTranscriptionItem(
// 		dynamoClient,
// 		config.app.tableName,
// 		'abc',
// 	);
// 	if (!item) {
// 		throw new Error(errorMessage);
// 	}
//
// 	await exportMediaToDrive(config, s3Client, item, {}, 'abc');
// };

const handler: Handler = async (event) => {
	console.log(event);
	return 'Finished processing Event';
};

// when running locally bypass the handler
if (!process.env['AWS_EXECUTION_ENV']) {
	console.log('Running locally - doing nothing');
}
export { handler as mediaExport };
