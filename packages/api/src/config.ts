import { findParameter, getParameters } from './configHelpers';
import { Parameter, SSM } from '@aws-sdk/client-ssm';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

export interface TranscriptionConfig {
	test: string; // TODO: This is just the foundation of getting params from SSM
	auth: {
		clientId: string;
		clientSecret: string;
	};
	app: {
		secret: string;
		rootUrl: string;
	};
}

const region = process.env['AWS_REGION'];

const credentialProvider =
	process.env['AWS_EXECUTION_ENV'] === undefined
		? defaultProvider({ profile: 'investigations' })
		: undefined;

const ssm = new SSM({
	region,
	credentials: credentialProvider,
});

export const getConfig = async (): Promise<TranscriptionConfig> => {
	const stage = process.env['STAGE'] || 'DEV';
	const paramPath = `/${stage}/investigations/transcription-service/`;

	const parameters = await getParameters(paramPath, ssm);
	const parameterNames = parameters.map((param: Parameter) => {
		return param.Name;
	});

	console.log(`Parameters fetched: ${parameterNames.join(', ')}`);
	const testParam = findParameter(parameters, paramPath, 'test');

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
		test: testParam,
		auth: {
			clientId: authClientId,
			clientSecret: authClientSecret,
		},
		app: {
			rootUrl: appRootUrl,
			secret: appSecret,
		},
	};
};
