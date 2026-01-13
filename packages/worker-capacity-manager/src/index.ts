import { Handler } from 'aws-lambda';

import {
	getASGClient,
	getConfig,
	getSQSClient,
	logger,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { getMaxCapacity, refreshASG, setDesiredCapacity } from './asg';
import { getSQSQueueLengthIncludingInvisible } from './sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';

const JOBS_PER_BOX = 3;

const updateASGCapacity = async (
	asgClient: AutoScalingClient,
	sqsClient: SQSClient,
	queueUrl: string,
	asgName: string,
	absoluteMinCapacity: number = 0,
) => {
	const totalMessagesInQueue = await getSQSQueueLengthIncludingInvisible(
		sqsClient,
		queueUrl,
	);

	const asgMaxCapacity = await getMaxCapacity(asgClient, asgName);
	if (asgMaxCapacity === undefined) {
		logger.warn('Failed to get ASG max capacity');
		return;
	}
	logger.info(`ASG ${asgName} max capacity is ${asgMaxCapacity}`);
	if (absoluteMinCapacity > asgMaxCapacity) {
		throw new Error("absoluteMinCapacity can't be greater than asgMaxCapacity");
	}

	// It takes so long to start a new instance, we assume that it will generally
	// be faster to allocate multiple jobs to the same box
	const numServersForMessages = Math.ceil(totalMessagesInQueue / JOBS_PER_BOX);

	const minCapacity = Math.min(numServersForMessages, asgMaxCapacity);

	const desiredCapacity = Math.max(minCapacity, absoluteMinCapacity);

	await setDesiredCapacity(asgClient, asgName, desiredCapacity);
};

const updateASGsCapacity = async (
	config: TranscriptionConfig,
	asgClient: AutoScalingClient,
) => {
	const sqsClient = getSQSClient(config.aws, config.dev?.localstackEndpoint);
	await updateASGCapacity(
		asgClient,
		sqsClient,
		config.app.taskQueueUrl,
		config.app.cpuAsgName,
	);
	await updateASGCapacity(
		asgClient,
		sqsClient,
		config.app.gpuTaskQueueUrl,
		config.app.gpuAsgName,
		config.app.stage === 'PROD' ? 1 : 0, // always have at least 1 GPU worker in PROD
	);
};
const handler: Handler = async (event) => {
	const config = await getConfig();
	const asgClient = getASGClient(config.aws);
	if (event.source === 'aws.s3' && event['detail-type'] === 'Object Created') {
		// new worker artifact - refresh the autoscaling group
		await refreshASG(
			asgClient,
			`transcription-service-gpu-workers-${config.app.stage}`,
		);
		return 'Triggered instance refresh';
	} else {
		await updateASGsCapacity(config, asgClient);
		return 'Updated the ASG capacity';
	}
};

if (!process.env['AWS_EXECUTION_ENV']) {
	getConfig().then((config) =>
		updateASGsCapacity(config, getASGClient(config.aws)),
	);
}

export { handler as workerCapacityManager };
