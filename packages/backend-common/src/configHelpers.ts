import {
	GetParametersByPathCommandOutput,
	Parameter,
	SSM,
} from '@aws-sdk/client-ssm';
import { logger } from '@guardian/transcription-service-backend-common';
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

export const getParameters = async (
	paramPath: string,
	ssm: SSM,
): Promise<Parameter[]> => {
	try {
		let nextToken: string | undefined = undefined;
		let parameters: Parameter[] | undefined = [];

		do {
			const data: GetParametersByPathCommandOutput =
				await ssm.getParametersByPath({
					Path: paramPath,
					Recursive: true,
					WithDecryption: true,
					NextToken: nextToken,
				});
			if (data.Parameters) {
				parameters = parameters.concat(data.Parameters);
			}
			nextToken = data.NextToken;
		} while (nextToken);

		if (parameters) {
			return parameters;
		} else {
			throw new Error('No parameters fetched from Parameter Store');
		}
	} catch (err) {
		logger.error('Error fetching parameters from Parameter Store', err);
		throw err;
	}
};

export const getSecret = async (
	secretName: string,
	smClient: SecretsManager,
) => {
	try {
		const data = await smClient.getSecretValue({ SecretId: secretName });
		if (data.SecretString) {
			return data.SecretString;
		} else {
			throw new Error('No secret fetched from Secrets Manager');
		}
	} catch (err) {
		logger.error('Error fetching secret from Secrets Manager', err);
		throw err;
	}
};

export const findParameter = (
	parameters: Parameter[],
	paramPath: string,
	paramKey: string,
): string => {
	const parameter = parameters.find(
		(param: Parameter) => param.Name === `${paramPath}${paramKey}`,
	);

	return getValueOfParam(paramKey, parameter);
};

export const getValueOfParam = (
	paramKey: string,
	parameter?: Parameter,
): string => {
	if (!parameter) {
		throw new Error(`The parameter ${paramKey} hasn't been configured`);
	}
	if (!parameter.Value) {
		throw new Error(`The parameter ${paramKey} has no value`);
	}
	return parameter.Value;
};
