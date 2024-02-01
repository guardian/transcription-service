import { findParameter, getParameters } from './configHelpers';
import { Parameter, SSM } from '@aws-sdk/client-ssm';

interface TranscriptionConfig {
	stage: string;
	taskQueueUrl: string;
}

const getStage = async (): Promise<string> => {
	if (process.env['STAGE']) {
		return process.env['STAGE'];
	}
	return 'DEV';
};

const getRegion = async (): Promise<string> => {
	if (process.env['AWS_REGION']) {
		return Promise.resolve(process.env['AWS_REGION']);
	}
	const availabilityZone = await fetch(
		'http://169.254.169.254/latest/meta-data/placement/availability-zone',
	).then((res) => res.text());
	// availabilityZone is in the form eu-west-1a
	return availabilityZone.slice(0, -1);
};

export const getConfig = async (): Promise<TranscriptionConfig> => {
	const region = await getRegion();
	const ssm = new SSM({
		region,
	});
	const stage = await getStage();
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
