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
import {
	activityTypes,
	buildQueueUrl,
	priorityLevels,
	sensitivityLevels,
} from '@guardian/transcription-service-common/src/queue-gardens';

const updateASGCapacity = async (
	asgClient: AutoScalingClient,
	sqsClient: SQSClient,
	queuesBaseUrl: string,
	asgName: string,
	stage: string,
) => {
	const absoluteMinCapacity = stage === 'PROD' ? 1 : 0; // always have at least 1 GPU worker in PROD

	const queueLengths = await Promise.all(
		activityTypes.flatMap((activityType) =>
			sensitivityLevels.flatMap((sensitivityLevel) =>
				priorityLevels
					.filter((_) => _ !== 'low') // we rely on the permanent instance to handle low priority jobs, so we don't want to scale based on them
					.flatMap((priorityLevel) => {
						const queueUrl = buildQueueUrl(
							queuesBaseUrl,
							'queue',
							priorityLevel,
							sensitivityLevel,
							activityType,
							stage,
						);
						return getSQSQueueLengthIncludingInvisible(sqsClient, queueUrl);
					}),
			),
		),
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

	const totalMessagesInQueue = queueLengths.reduce(
		(acc, current) => acc + current,
	);

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
		config.app.queuesBaseUrl,
		gpuAsgName,
		config.app.stage,
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
