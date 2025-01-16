import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
	PutCommand,
	DynamoDBDocumentClient,
	GetCommand,
} from '@aws-sdk/lib-dynamodb';

import { z } from 'zod';
import { logger } from '@guardian/transcription-service-backend-common';
import { ExportStatus } from '@guardian/transcription-service-common';

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
	completedAt: z.optional(z.string()), // dynamodb can't handle dates so we need to use an ISO date
	isTranslation: z.boolean(),
	exportStatus: z.optional(z.array(ExportStatus)),
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
		return item.id;
	} catch (error) {
		logger.error('error writing to db', error);
		throw error;
	}
};

export const getItem = async (
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

export type OwnershipCheck = {
	check: boolean;
	currentUserEmail?: string;
};

export const getTranscriptionItem = async (
	client: DynamoDBDocumentClient,
	tableName: string,
	itemId: string,
	ownershipCheck: OwnershipCheck,
): Promise<{ item?: TranscriptionDynamoItem; errorMessage?: string }> => {
	const item = await getItem(client, tableName, itemId);
	if (!item) {
		const msg = `Failed to fetch item with id ${itemId} from database.`;
		logger.error(msg);
		return { errorMessage: msg };
	}
	const parsedItem = TranscriptionDynamoItem.safeParse(item);
	if (!parsedItem.success) {
		const msg = `Failed to parse item ${itemId} from dynamodb. Error: ${parsedItem.error.message}`;
		logger.error(msg);
		return { errorMessage: msg };
	}
	if (
		ownershipCheck.check &&
		parsedItem.data.userEmail !== ownershipCheck.currentUserEmail
	) {
		// users can only export their own transcripts. Return a 404 to avoid leaking information about other users' transcripts
		logger.warn(
			`User ${ownershipCheck.currentUserEmail} attempted to export transcript ${item.id} which does not belong to them.`,
		);
		return { errorMessage: 'Unauthorised' };
	}
	return { item: parsedItem.data };
};
