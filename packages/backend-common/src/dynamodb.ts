import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
	PutCommand,
	DynamoDBDocumentClient,
	GetCommand,
} from '@aws-sdk/lib-dynamodb';

import { z } from 'zod';
import { logger } from '@guardian/transcription-service-backend-common';

export const getDynamoClient = (
	region: string,
	localstackEndpoint?: string,
) => {
	const clientBaseConfig = {
		region,
	};

	const clientConfig = localstackEndpoint
		? { ...clientBaseConfig, endpoint: localstackEndpoint }
		: clientBaseConfig;

	const client = new DynamoDBClient(clientConfig);
	return DynamoDBDocumentClient.from(client);
};

export const TranscriptKeys = z.object({
	srt: z.string(),
	text: z.string(),
	json: z.string(),
});

export type TranscriptKeys = z.infer<typeof TranscriptKeys>;

export const TranscriptionDynamoItem = z.object({
	id: z.string(),
	originalFilename: z.string(),
	transcriptKeys: TranscriptKeys,
	userEmail: z.string(),
});

export type TranscriptionDynamoItem = z.infer<typeof TranscriptionDynamoItem>;

export const writeTranscriptionItem = async (
	client: DynamoDBDocumentClient,
	tableName: string,
	item: TranscriptionDynamoItem,
) => {
	const command = new PutCommand({
		TableName: tableName,
		Item: item,
	});

	try {
		await client.send(command);
		logger.info(`saved to db item ${item.id}`);
	} catch (error) {
		logger.error('error writing to db', error);
		throw error;
	}
};

export const getTranscriptionItem = async (
	client: DynamoDBDocumentClient,
	tableName: string,
	itemId: string,
) => {
	const command = new GetCommand({
		TableName: tableName,
		Key: {
			id: itemId,
		},
	});
	try {
		const result = await client.send(command);
		return result.Item;
	} catch (error) {
		logger.error(`Failed to get item ${itemId} from dynamodb`, error);
		return undefined;
	}
};
