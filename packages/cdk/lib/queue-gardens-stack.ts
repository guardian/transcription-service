import { GuStack, type GuStackProps } from '@guardian/cdk/lib/constructs/core';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common/src/constants';
import type { PriorityLevel } from '@guardian/transcription-service-common/src/queue-gardens';
import {
	activityTypes,
	sensitivityLevels,
} from '@guardian/transcription-service-common/src/queue-gardens';
import type { App } from 'aws-cdk-lib';
// eslint-disable-next-line import/no-namespace -- code reads better if prefixed by sqs.
import * as sqs from 'aws-cdk-lib/aws-sqs';
// eslint-disable-next-line import/no-namespace -- code reads better if prefixed by ssm.
import * as ssm from 'aws-cdk-lib/aws-ssm';

const priorityLevelToQueueProps = {
	high: {},
	standard: {},
	low: {}, //TODO probably a much longer expiry and higher retry allowance (application will need to shorten the visibility timeout to zero if cancelled)
} as const satisfies Record<PriorityLevel, sqs.QueueProps>;

const verifiedQueueName = (queueName: string) => {
	if (queueName.length > 80) {
		throw Error(
			`Queue name "${queueName}" exceeds the maximum length of 80 characters (by ${queueName.length - 80})`,
		);
	}
	return queueName;
};

export class QueueGardensStack extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		for (const [priorityLevel, priorityBasedQueueProps] of Object.entries(
			priorityLevelToQueueProps,
		)) {
			for (const sensitivityLevel of sensitivityLevels) {
				for (const activityType of activityTypes) {
					const buildQueueBaseName = (type: 'queue' | 'DLQ') =>
						`investigations-${type}_${priorityLevel.toUpperCase()}-priority_${sensitivityLevel}_${activityType}`;
					const queueBaseName = buildQueueBaseName('queue');
					const deadLetterQueueBaseName = buildQueueBaseName('DLQ');

					// TODO consider shared DLQs (by moving this definition up nested for-loops)
					const deadLetterQueue = new sqs.Queue(this, deadLetterQueueBaseName, {
						queueName: verifiedQueueName(
							`${deadLetterQueueBaseName}_${this.stage}`,
						),
					});

					const queue = new sqs.Queue(this, queueBaseName, {
						...priorityBasedQueueProps,
						queueName: verifiedQueueName(`${queueBaseName}_${this.stage}`),
						deadLetterQueue: {
							queue: deadLetterQueue,
							maxReceiveCount: MAX_RECEIVE_COUNT,
						},
					});

					new ssm.StringParameter(this, `SSM_${queueBaseName}`, {
						parameterName: `/investigations-queues/${this.stage}/${priorityLevel.toUpperCase()}-priority/${sensitivityLevel}/${activityType}/arn`,
						description: `QueueGardens ${this.stage} queue for ${activityType} tasks with a ${priorityLevel.toUpperCase()} priority, for ${sensitivityLevel} stuff`,
						stringValue: queue.queueArn,
					});
				}
			}
		}
	}
}
