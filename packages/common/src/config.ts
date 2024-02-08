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
		sourceMediaBucket: string;
		destinationTopicArns: {
			transcriptionService: string;
		};
	};
	aws: {
		region: string;
		localstackEndpoint?: string;
	};
}

const credentialProvider = (onAws: boolean) =>
	onAws ? undefined : defaultProvider({ profile: 'investigations' });

// We need to know the region and STAGE before fetching parameters from SSM. On lambda these values can be retrieved from
// environment variables, on EC2 instances we need to use the instance metadata service. Locally, we hard code
// the relevant environment variables in our package.json scripts.
const getEnvVarOrMetadata = async (
	envVar: string,
	metadataPath: string,
	clean?: (input: string) => string,
): Promise<string> => {
	const env = process.env[envVar];
	if (env !== undefined) {
		return Promise.resolve(env);
	}
	// see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html for metadata docs
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
		// availability zone has the format eu-west-1a, we need to remove the last character to get the region
		(az) => az.slice(0, -1),
	);
	const stage = await getEnvVarOrMetadata('STAGE', 'tags/instance/Stage');
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
	const destinationTopic = findParameter(
		parameters,
		paramPath,
		'destinationTopicArns/transcriptionService',
	);
	// AWS clients take an optional 'endpoint' property that is only needed by localstack - on code/prod you don't need
	// to set it. Here we inder the endpoint (http://localhost:4566) from the sqs url
	const localstackEndpoint =
		stage === 'DEV' ? new URL(taskQueueUrl).origin : undefined;

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
			sourceMediaBucket: 'my-bucket',
			destinationTopicArns: {
				transcriptionService: destinationTopic,
			},
		},
		aws: {
			region,
			localstackEndpoint,
		},
	};
};