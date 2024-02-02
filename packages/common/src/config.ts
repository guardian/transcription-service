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

const credentialProvider = (onAws: boolean) =>
	onAws ? undefined : defaultProvider({ profile: 'investigations' });

const getEnvVarOrMetadata = async (
	envVar: string,
	metadataPath: string,
	fallback?: string,
	clean?: (input: string) => string,
): Promise<string> => {
	const env = process.env[envVar];
	if (env !== undefined) {
		return Promise.resolve(env);
	}
	// see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html for metadata docs
	if (fallback) {
		return fallback;
	}
	const metadataResult = await fetch(
		`http://169.254.169.254/latest/meta-data/${metadataPath}`,
	);
	const metadataValue = await metadataResult.text();
	return clean ? clean(metadataValue) : metadataValue;
};

export const getConfig = async (): Promise<TranscriptionConfig> => {
	const region = await getEnvVarOrMetadata(
		'AWS_REGION',
		'placement/availability-zone',
		'eu-west-1',
		(az) => az.slice(0, -1),
	);
	const stage = await getEnvVarOrMetadata(
		'STAGE',
		'tags/instance/Stage',
		'DEV',
	);
	const ssm = new SSM({
		region,
		credentials: credentialProvider(stage !== 'DEV'),
	});

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
