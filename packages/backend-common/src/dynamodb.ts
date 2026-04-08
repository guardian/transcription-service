import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
	PutCommand,
	DynamoDBDocumentClient,
	GetCommand,
} from '@aws-sdk/lib-dynamodb';

import { logger } from '@guardian/transcription-service-backend-common';
import {
	TranscriptionDynamoItem,
	YoutubeEventDynamoItem,
	LlmDynamoItem,
} from '@guardian/transcription-service-common';
import { AwsConfig } from './types';

export const getDynamoClient = (
	awsConfig: AwsConfig,
	localstackEndpoint?: string,
) => {
	const clientConfig = localstackEndpoint
		? { ...awsConfig, endpoint: localstackEndpoint }
		: awsConfig;

	const client = new DynamoDBClient(clientConfig);
	return DynamoDBDocumentClient.from(client);
};

export const writeDynamoItem = async (
	client: DynamoDBDocumentClient,
	tableName: string,
	item: TranscriptionDynamoItem | YoutubeEventDynamoItem | LlmDynamoItem,
) => {
	const command = new PutCommand({
		TableName: tableName,
		Item: item,
	});

	try {
		await client.send(command);
		logger.info(`saved to db item ${item.id}`);
		return item.id;
	} catch (error) {
		logger.error('error writing to db', error);
		throw error;
	}
};

const getItem = async (
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

export const getYoutubeEventItem = async (
	client: DynamoDBDocumentClient,
	tableName: string,
	itemId: string,
): Promise<YoutubeEventDynamoItem | undefined> => {
	const item = await getItem(client, tableName, itemId);
	if (!item) {
		return undefined;
	}
	const parsedItem = YoutubeEventDynamoItem.safeParse(item);
	if (!parsedItem.success) {
		const msg = `Failed to parse Youtube event item ${itemId} from dynamodb. Error: ${parsedItem.error.message}`;
		logger.error(msg);
		return undefined;
	}
	return parsedItem.data;
};

export type OwnershipCheck = {
	check: boolean;
	currentUserEmail?: string;
};

type GetTranscriptionItemSuccess = {
	status: 'success';
	item: TranscriptionDynamoItem;
};

type GetTranscriptionItemFailure = {
	status: 'failure';
	statusCode: number;
	errorMessage: string;
};

type GetTranscriptionItemResult =
	| GetTranscriptionItemSuccess
	| GetTranscriptionItemFailure;

export const getTranscriptionItem = async (
	client: DynamoDBDocumentClient,
	tableName: string,
	itemId: string,
	ownershipCheck: OwnershipCheck,
): Promise<GetTranscriptionItemResult> => {
	const item = await getItem(client, tableName, itemId);
	const genericNotFoundMessage = 'Transcript not found';
	if (!item) {
		const msg = `Failed to fetch item with id ${itemId} from database.`;
		logger.error(msg);
		return {
			status: 'failure',
			errorMessage: genericNotFoundMessage,
			statusCode: 404,
		};
	}
	const parsedItem = TranscriptionDynamoItem.safeParse(item);
	if (!parsedItem.success) {
		const msg = `Failed to parse item ${itemId} from dynamodb. Error: ${parsedItem.error.message}`;
		logger.error(msg);
		return { status: 'failure', errorMessage: msg, statusCode: 500 };
	}
	if (
		ownershipCheck.check &&
		parsedItem.data.userEmail !== ownershipCheck.currentUserEmail
	) {
		// users can only export their own transcripts. Return a 404 to avoid leaking information about other users' transcripts
		logger.warn(
			`User ${ownershipCheck.currentUserEmail} attempted to export transcript ${item.id} which does not belong to them.`,
		);
		return {
			status: 'failure',
			errorMessage: genericNotFoundMessage,
			statusCode: 404,
		};
	}
	return { status: 'success', item: parsedItem.data };
};

type GetLlmItemSuccess = {
	status: 'SUCCESS';
	item: LlmDynamoItem;
};

type GetLlmItemFailure = {
	status: 'FAILURE';
	statusCode: number;
	errorMessage: string;
};

type GetLlmItemResult = GetLlmItemSuccess | GetLlmItemFailure;

export const getLlmItem = async (
	client: DynamoDBDocumentClient,
	tableName: string,
	itemId: string,
	ownershipCheck: OwnershipCheck,
): Promise<GetLlmItemResult> => {
	const item = await getItem(client, tableName, itemId);
	const genericNotFoundMessage = 'LLM result not found';
	if (!item) {
		const msg = `Failed to fetch LLM item with id ${itemId} from database.`;
		logger.error(msg);
		return {
			status: 'FAILURE',
			errorMessage: genericNotFoundMessage,
			statusCode: 404,
		};
	}
	const parsedItem = LlmDynamoItem.safeParse(item);
	if (!parsedItem.success) {
		const msg = `Failed to parse LLM item ${itemId} from dynamodb. Error: ${parsedItem.error.message}`;
		logger.error(msg);
		return { status: 'FAILURE', errorMessage: msg, statusCode: 500 };
	}
	if (
		ownershipCheck.check &&
		parsedItem.data.userEmail !== ownershipCheck.currentUserEmail
	) {
		logger.warn(
			`User ${ownershipCheck.currentUserEmail} attempted to access LLM result ${item.id} which does not belong to them.`,
		);
		return {
			status: 'FAILURE',
			errorMessage: genericNotFoundMessage,
			statusCode: 404,
		};
	}
	return { status: 'SUCCESS', item: parsedItem.data };
};
