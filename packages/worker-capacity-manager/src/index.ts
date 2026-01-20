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

	const minCapacity = Math.min(totalMessagesInQueue, asgMaxCapacity);

	const desiredCapacity = Math.max(minCapacity, absoluteMinCapacity);

	await setDesiredCapacity(asgClient, asgName, desiredCapacity);
};

const updateASGsCapacity = async () => {
	const config = await getConfig();
	const sqsClient = getSQSClient(config.aws, config.dev?.localstackEndpoint);
	const asgClient = getASGClient(config.aws);
	const gpuAsgName = `transcription-service-gpu-workers-${config.app.stage}`;
	// cpu capacity manager has been disabled whilst we aren't using whisper.cpp
	// await updateASGCapacity(
	// 	asgClient,
	// 	sqsClient,
	// 	config.app.taskQueueUrl,
	// 	`transcription-service-workers-${config.app.stage}`,
	// );

	await updateASGCapacity(
		asgClient,
		sqsClient,
		config.app.gpuTaskQueueUrl,
		gpuAsgName,
		config.app.stage === 'PROD' ? 1 : 0, // always have at least 1 GPU worker in PROD
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
