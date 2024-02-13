import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { z } from 'zod';

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

export const Transcript = z.object({
	srt: z.string(),
	text: z.string(),
	json: z.string(),
});
export const TranscriptionItem = z.object({
	id: z.string(),
	originalFilename: z.string(),
	transcript: Transcript,
	userEmail: z.string(),
});

export type TranscriptionItem = z.infer<typeof TranscriptionItem>;

export const writeTranscriptionItem = async (
	client: DynamoDBDocumentClient,
	tableName: string,
	item: TranscriptionItem,
) => {
	const command = new PutCommand({
		TableName: tableName,
		Item: item,
	});

	try {
		await client.send(command);
		console.log(`saved to db item ${item.id}`);
	} catch (error) {
		console.error('error writing to db', error);
		throw error;
	}
};