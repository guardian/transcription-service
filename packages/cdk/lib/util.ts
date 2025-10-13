import type { GuStack } from '@guardian/cdk/lib/constructs/core';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { Topic } from 'aws-cdk-lib/aws-sns';
import { Subscription, SubscriptionProtocol } from 'aws-cdk-lib/aws-sns';
import type { Queue } from 'aws-cdk-lib/aws-sqs';

export const addSubscription = (
	scope: GuStack,
	id: string,
	queue: Queue,
	topic: Topic,
) => {
	new Subscription(scope, `CombinedTaskTopic${id}Subscription`, {
		topic: topic,
		endpoint: queue.queueArn,
		protocol: SubscriptionProtocol.SQS,
	});

	queue.addToResourcePolicy(
		new PolicyStatement({
			effect: Effect.ALLOW,
			principals: [new ServicePrincipal('sns.amazonaws.com')],
			actions: ['sqs:SendMessage'],
			resources: [queue.queueArn],
			conditions: {
				ArnEquals: {
					'AWS:SourceArn': topic.topicArn,
				},
			},
		}),
	);
};
