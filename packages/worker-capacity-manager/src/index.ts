import { Handler } from 'aws-lambda';

import {
	getASGClient,
	getConfig,
	getSQSClient,
} from '@guardian/transcription-service-backend-common';
import { setDesiredCapacity } from './asg';
import { getSQSQueueLengthIncludingInvisible } from './sqs';

const updateASGCapacity = async () => {
	const config = await getConfig();
	const sqsClient = getSQSClient(
		config.aws.region,
		config.aws.localstackEndpoint,
	);
	const asgClient = getASGClient(config.aws.region);
	const asgGroupName = `transcription-service-workers-${config.app.stage}`;

	const totalMessagesInQueue = await getSQSQueueLengthIncludingInvisible(
		sqsClient,
		config.app.taskQueueUrl,
	);

	console.log(
		`setting asg desired capacity to total messages in queue: ${totalMessagesInQueue}`,
	);
	await setDesiredCapacity(asgClient, asgGroupName, totalMessagesInQueue);
};
const handler: Handler = async () => {
	await updateASGCapacity();
	return 'Updated the ASG capacity';
};

if (!process.env['AWS_EXECUTION_ENV']) {
	updateASGCapacity();
}

export { handler as workerCapacityManager };
