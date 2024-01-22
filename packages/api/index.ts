import {
	APIGatewayProxyEvent,
	APIGatewayEventRequestContext,
	APIGatewayProxyCallback,
	APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import serverlessExpress from "@codegenie/serverless-express"

// export const handler = (
// 	event: APIGatewayProxyEvent,
// 	context: APIGatewayEventRequestContext,
// 	callback: APIGatewayProxyCallback,
// ): Promise<APIGatewayProxyStructuredResultV2> => {
// 	const message = 'Hello World!';
// 	console.log(message);
//     console.log(event.body, context.accountId, callback.name);
// 	const result = {
// 		"isBase64Encoded": true,
// 		"statusCode": 200,
// 		"headers": {  },
// 		"body": message
// 	}
// 	return Promise.resolve(result);
// };

let api
if (process.env["AWS_EXECUTION_ENV"] !== undefined){
	console.log("Running on lambda")

	let serverlessExpressHandler: any
	const serverlessHandler = getApp().then((app) => (serverlessExpressHandler = serverlessExpress({ app }.handler)))
} else {
	console.log("running locally")
}