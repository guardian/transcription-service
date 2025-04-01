import { Handler } from 'aws-lambda';

import {
	getASGClient,
	getConfig,
	getSQSClient,
	logger,
} from '@guardian/transcription-service-backend-common';
import { setDesiredCapacity } from './asg';
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

	// TODO get max capacity from ASG and replace hardcoded value
	const prodAsgMaxCapacity = 20;
	const desiredCapacity = Math.min(totalMessagesInQueue, prodAsgMaxCapacity);

	logger.info(
		`setting asg desired capacity to total messages in queue: ${totalMessagesInQueue}`,
	);
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
