import { findParameter, getParameters } from './configHelpers';
import { Parameter, SSM } from '@aws-sdk/client-ssm';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
export interface TranscriptionConfig {
	auth: {
		clientId: string;
		clientSecret: string;
	};
	app: {
		secret: string;
		rootUrl: string;
		taskQueueUrl: string;
		stage: string;
	};
}

const getStage = async (): Promise<string> => {
	if (process.env['STAGE']) {
		return process.env['STAGE'];
	}
	return 'DEV';
};

const credentialProvider =
	process.env['AWS_EXECUTION_ENV'] === undefined
		? defaultProvider({ profile: 'investigations' })
		: undefined;

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
		credentials: credentialProvider,
	});
	const stage = await getStage();
	const paramPath = `/${stage}/investigations/transcription-service/`;

	const parameters = await getParameters(paramPath, ssm);
	const parameterNames = parameters.map((param: Parameter) => {
		return param.Name;
	});

	console.log(`Parameters fetched: ${parameterNames.join(', ')}`);
	const taskQueueUrl = findParameter(parameters, paramPath, 'taskQueueUrl');

	const authClientId = findParameter(parameters, paramPath, 'auth/clientId');
	const authClientSecret = findParameter(
		parameters,
		paramPath,
		'auth/clientSecret',
	);

	const appSecret = findParameter(parameters, paramPath, 'app/secret');

	// To locally emulating production, the value of appRootUrl should be changed to api.transcribe domain
	const appRootUrl = findParameter(parameters, paramPath, 'app/rootUrl');

	return {
		auth: {
			clientId: authClientId,
			clientSecret: authClientSecret,
		},
		app: {
			rootUrl: appRootUrl,
			secret: appSecret,
			taskQueueUrl,
			stage,
		},
	};
};
