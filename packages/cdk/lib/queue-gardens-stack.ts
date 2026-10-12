import { GuStack, type GuStackProps } from '@guardian/cdk/lib/constructs/core';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common/src/constants';
import type { PriorityLevel } from '@guardian/transcription-service-common/src/queue-gardens';
import {
	activityTypes,
	buildVerifiedQueueName,
	sensitivityLevels,
} from '@guardian/transcription-service-common/src/queue-gardens';
import type { App } from 'aws-cdk-lib';
import type { QueueProps } from 'aws-cdk-lib/aws-sqs';
import { Queue } from 'aws-cdk-lib/aws-sqs';

// TODO keep in mind the pre-signed URLs w.r.t. expiry, is there a better way to achieve the sharing between apps
const priorityLevelToQueueProps = {
	high: {},
	standard: {},
	low: {}, //TODO probably a much longer expiry and higher retry allowance (application will need to shorten the visibility timeout to zero if cancelled)
} as const satisfies Record<PriorityLevel, QueueProps>;

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
					const deadLetterQueue = new Queue(this, buildQueueName('DLQ'), {
						queueName: buildQueueName('DLQ', this.stage),
					});

					new Queue(this, buildQueueName('queue'), {
						...priorityBasedQueueProps,
						queueName: buildQueueName('queue', this.stage),
						deadLetterQueue: {
							queue: deadLetterQueue,
							maxReceiveCount: MAX_RECEIVE_COUNT,
						},
					});

					// IMPORTANT: permissions to read/write from these queues are defined
					// in the consuming stacks (using buildQueueName to lookup)
				}
			}
		}
	}
}
