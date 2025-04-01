import { Handler } from 'aws-lambda';

import {
	getASGClient,
	getConfig,
	getSQSClient,
	logger,
} from '@guardian/transcription-service-backend-common';
import { getMaxCapacity, setDesiredCapacity } from './asg';
import { getSQSQueueLengthIncludingInvisible } from './sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';

const updateASGCapacity = async (
	asgClient: AutoScalingClient,
	sqsClient: SQSClient,
	queueUrl: string,
	asgName: string,
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

	const desiredCapacity = Math.min(totalMessagesInQueue, asgMaxCapacity);

	await setDesiredCapacity(asgClient, asgName, desiredCapacity);
};

const updateASGsCapacity = async () => {
	const config = await getConfig();
	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);
	const asgClient = getASGClient(config.aws.region);
	const asgName = `transcription-service-workers-${config.app.stage}`;
	const gpuAsgName = `transcription-service-gpu-workers-${config.app.stage}`;
	await updateASGCapacity(
		asgClient,
		sqsClient,
		config.app.taskQueueUrl,
		asgName,
	);
	await updateASGCapacity(
		asgClient,
		sqsClient,
		config.app.gpuTaskQueueUrl,
		gpuAsgName,
	);
};
const handler: Handler = async () => {
	await updateASGsCapacity();
	return 'Updated the ASG capacity';
};

if (!process.env['AWS_EXECUTION_ENV']) {
	updateASGsCapacity();
}

export { handler as workerCapacityManager };
