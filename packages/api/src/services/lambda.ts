import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { logger } from '@guardian/transcription-service-backend-common';

export const LAMBDA_MAX_EPHEMERAL_STORAGE_BYTES = 10240 * 1024 * 1024;

export const invokeLambda = async (
	lambdaClient: LambdaClient,
	functionName: string,
	payload: string,
) => {
	const command = new InvokeCommand({
		FunctionName: functionName,
		Payload: Buffer.from(payload),
		InvocationType: 'Event',
	});

	const response = await lambdaClient.send(command);

	// see https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html for details of the response
	if (response.StatusCode === 200 || response.StatusCode === 202) {
		logger.info('Invocation successful');
		return;
	} else {
		logger.error(
			`Failed to invoke Lambda. Status code: ${response.StatusCode}`,
		);
		throw new Error('Failed to request source media export');
	}
};
