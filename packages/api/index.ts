// src/index.ts

import {
	APIGatewayProxyEvent,
	APIGatewayEventRequestContext,
	APIGatewayProxyCallback,
} from 'aws-lambda';

export const handler = (
	event: APIGatewayProxyEvent,
	context: APIGatewayEventRequestContext,
	callback: APIGatewayProxyCallback,
): Promise<string> => {
	const message = 'Hello World!';
	console.log(message);
    console.log(event.body, context.accountId, callback.name);
	return Promise.resolve(message);
};