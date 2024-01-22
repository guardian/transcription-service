// src/index.ts

import {
	APIGatewayProxyEvent,
	APIGatewayEventRequestContext,
	APIGatewayProxyCallback,
	APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

export const handler = (
	event: APIGatewayProxyEvent,
	context: APIGatewayEventRequestContext,
	callback: APIGatewayProxyCallback,
): Promise<APIGatewayProxyStructuredResultV2> => {
	const message = 'Hello World!';
	console.log(message);
    console.log(event.body, context.accountId, callback.name);
	const result = {
		"isBase64Encoded": true,
		"statusCode": 200,
		"headers": {  },
		"body": message
	}
	return Promise.resolve(result);
};