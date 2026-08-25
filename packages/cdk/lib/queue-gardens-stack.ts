import { GuStack, type GuStackProps } from '@guardian/cdk/lib/constructs/core';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common/src/constants';
import type { PriorityLevel } from '@guardian/transcription-service-common/src/queue-gardens';
import {
	activityTypes,
	buildVerifiedQueueName,
	sensitivityLevels,
} from '@guardian/transcription-service-common/src/queue-gardens';
import type { App } from 'aws-cdk-lib';
// eslint-disable-next-line import/no-namespace -- code reads better if prefixed by sqs.
import * as sqs from 'aws-cdk-lib/aws-sqs';

const priorityLevelToQueueProps = {
	high: {},
	standard: {},
	low: {}, //TODO probably a much longer expiry and higher retry allowance (application will need to shorten the visibility timeout to zero if cancelled)
} as const satisfies Record<PriorityLevel, sqs.QueueProps>;

export class QueueGardensStack extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		for (const [priorityLevel, priorityBasedQueueProps] of Object.entries(
			priorityLevelToQueueProps,
		)) {
			for (const sensitivityLevel of sensitivityLevels) {
				for (const activityType of activityTypes) {
					const buildQueueName = buildVerifiedQueueName(
						priorityLevel as PriorityLevel,
						sensitivityLevel,
						activityType,
					);

					// TODO consider shared DLQs (by moving this definition up nested for-loops)
					const deadLetterQueue = new sqs.Queue(this, buildQueueName('DLQ'), {
						queueName: buildQueueName('DLQ', this.stage),
					});

					new sqs.Queue(this, buildQueueName('queue'), {
						...priorityBasedQueueProps,
						queueName: buildQueueName('queue', this.stage),
						deadLetterQueue: {
							queue: deadLetterQueue,
							maxReceiveCount: MAX_RECEIVE_COUNT,
						},
					});
				}
			}
		}
	}
}
