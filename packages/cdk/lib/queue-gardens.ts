import { GuStack, type GuStackProps } from '@guardian/cdk/lib/constructs/core';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common/src/constants';
import type { App } from 'aws-cdk-lib';
// eslint-disable-next-line import/no-namespace -- code reads better if prefixed by sqs.
import * as sqs from 'aws-cdk-lib/aws-sqs';
// eslint-disable-next-line import/no-namespace -- code reads better if prefixed by ssm.
import * as ssm from 'aws-cdk-lib/aws-ssm';

const priorityLevelToQueueProps = {
	// trumps standard, but will let the current standard level job complete - might result in higher cost services being used to clear
	high: {},
	// trumps low and will cancel low level jobs
	standard: {},
	// only expect things on here to be processed when our services are idle and will be killed if something comes in on standard/high
	low: {}, //TODO probably a much longer expiry and higher retry allowance (application will need to shorten the visibility timeout to zero if cancelled)
} as const satisfies Record<string, sqs.QueueProps>;

// TODO for each consider linking to the type definition for the payload
const activityTypes = [
	'media-download',
	'transcription',
	'translation',
	'visual-ocr',
	'snapshotting',
	'ai-prompt',
] as const;

// used to determine where the activity takes place
const sensitivityLevels = [
	'public-domain', // for documents/files already in the public domain
	'regular-sensitivity', // non-public documents, which we should only process in AWS/on-prem
	// "super-sensitive" // super sensitive documents are only process by the offline giant in the bunker
] as const;

const verifiedQueueName = (queueName: string) => {
	if (queueName.length > 80) {
		throw Error(
			`Queue name "${queueName}" exceeds the maximum length of 80 characters (by ${queueName.length - 80})`,
		);
	}
	return queueName;
};

export class QueueGardens extends GuStack {
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
