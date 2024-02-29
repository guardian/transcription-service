import {
	GetParametersByPathCommandOutput,
	Parameter,
	SSM,
} from '@aws-sdk/client-ssm';
import { logger } from '@guardian/transcription-service-backend-common';

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
			logger.info('Fetched parameters from Parameter Store');
			return parameters;
		} else {
			throw new Error('No parameters fetched from Parameter Store');
		}
	} catch (err) {
		logger.error('Error fetching parameters from Parameter Store', err);
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
