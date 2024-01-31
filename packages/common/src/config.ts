import { findParameter, getParameters } from './configHelpers';
import { Parameter, SSM } from '@aws-sdk/client-ssm';

interface TranscriptionConfig {
	stage: string;
	taskQueueUrl: string;
}

const region = process.env['AWS_REGION'];

const ssm = new SSM({
	region,
});

export const getConfig = async (): Promise<TranscriptionConfig> => {
	const stage = process.env['STAGE'] || 'DEV';
	const paramPath = `/${stage}/investigations/transcription-service/`;

	const parameters = await getParameters(paramPath, ssm);
	const parameterNames = parameters.map((param: Parameter) => {
		return param.Name;
	});

	console.log(`Parameters fetched: ${parameterNames.join(', ')}`);
	const taskQueueUrl = findParameter(parameters, paramPath, 'taskQueueUrl');

	return {
		stage,
		taskQueueUrl,
	};
};
