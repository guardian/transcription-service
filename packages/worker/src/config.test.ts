import { getConfig } from '@guardian/transcription-service-backend-common/src/config';
import { getParameters } from '@guardian/transcription-service-backend-common/src/configHelpers';

jest.mock('@guardian/transcription-service-backend-common', () => ({
	logger: { info: jest.fn() },
}));
jest.mock(
	'@guardian/transcription-service-backend-common/src/configHelpers',
	() => ({
		...jest.requireActual(
			'@guardian/transcription-service-backend-common/src/configHelpers',
		),
		getParameters: jest.fn(),
	}),
);

const ordinaryParameters = [
	'auth/clientId',
	'auth/clientSecret',
	'app/secret',
	'app/emailNotificationFromAddress',
	'app/rootUrl',
	'app/sourceMediaBucket',
	'app/tableName',
	'app/transcriptionOutputBucket',
	'media-download/proxy-ssh-key-secret-arn',
	'app/mediaExportFunctionName',
	'media-download/proxy-ip-address',
	'app/eventsTableName',
	'app/youtubeBlocked',
	'media-download/gts-cookie',
	'dev/huggingfaceToken',
	'worker/artifactBucket',
	'worker/artifactKey',
	'llamacpp/modelPath',
	'llamacpp/installDirectory',
];
const queueParameters = {
	gpuTaskQueueName: 'gpu-tasks.fifo',
	mediaDownloadQueueName: 'media-download',
	deadLetterQueueName: 'dead-letters.fifo',
	'destinationQueueNames/transcriptionService': 'transcription-output',
	'destinationQueueNames/giant': 'giant-output.fifo',
};
const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
});

const configure = (stage: string, endpoint?: string) => {
	process.env.STAGE = stage;
	process.env.APP = 'transcription-service-gpu-worker';
	process.env.AWS_REGION = 'eu-west-1';
	delete process.env.LOCALSTACK_PORT;
	const values = {
		...Object.fromEntries(ordinaryParameters.map((key) => [key, 'configured'])),
		...queueParameters,
		...(endpoint ? { endpoint } : {}),
	};
	jest.mocked(getParameters).mockResolvedValue(
		Object.entries(values).map(([key, Value]) => ({
			Name: `/${stage}/investigations/transcription-service/${key}`,
			Value,
		})),
	);
};

it.each([undefined, '4567', '14567'])(
	'builds all DEV URLs using LocalStack port %s without an endpoint parameter',
	async (port) => {
		configure('DEV');
		if (port) process.env.LOCALSTACK_PORT = port;
		const config = await getConfig();
		const origin = `http://localhost:${port ?? '4566'}`;
		expect(config.dev?.localstackEndpoint).toBe(origin);
		expect(config.app.gpuTaskQueueUrl).toBe(
			`${origin}/000000000000/gpu-tasks.fifo`,
		);
		expect(config.app.mediaDownloadQueueUrl).toBe(
			`${origin}/000000000000/media-download`,
		);
		expect(Object.values(config.app.destinationQueueUrls)).toEqual([
			`${origin}/000000000000/transcription-output`,
			`${origin}/000000000000/giant-output.fifo`,
		]);
		expect(config.app.deadLetterQueueUrl).toBeUndefined();
	},
);

it.each(['CODE', 'PROD'])(
	'uses the SSM endpoint for %s, ignoring the local port',
	async (stage) => {
		const endpoint = 'https://sqs.eu-west-1.amazonaws.com/123456789012';
		configure(stage, stage === 'CODE' ? `${endpoint}/` : endpoint);
		process.env.LOCALSTACK_PORT = '4567';
		const config = await getConfig();
		expect(config.dev).toBeUndefined();
		expect(config.app.gpuTaskQueueUrl).toBe(`${endpoint}/gpu-tasks.fifo`);
		expect(config.app.deadLetterQueueUrl).toBe(`${endpoint}/dead-letters.fifo`);
		expect(config.app.mediaDownloadQueueUrl).toBe(`${endpoint}/media-download`);
		expect(Object.values(config.app.destinationQueueUrls)).toEqual([
			`${endpoint}/transcription-output`,
			`${endpoint}/giant-output.fifo`,
		]);
	},
);

it('requires an endpoint in deployed environments', async () => {
	configure('PROD');
	await expect(getConfig()).rejects.toThrow(
		"The parameter endpoint hasn't been configured",
	);
});
