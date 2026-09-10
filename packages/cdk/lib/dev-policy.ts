import type { GuStack } from '@guardian/cdk/lib/constructs/core';
import { GuDeveloperPolicyExperimental } from '@guardian/cdk/lib/experimental/constructs/iam/policies';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export const devPolicy = (stack: GuStack) => {
	new GuDeveloperPolicyExperimental(stack, 'TransciptionServiceLocalPolicy', {
		grantId: 'run-investigations-transcription-service-locally',
		friendlyName: 'Run investigations transcription service locally',
		withoutPolicyChecks: true,
		statements: [
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['ssm:GetParameter', 'ssm:GetParameters'],
				resources: [
					`arn:aws:ssm:${stack.region}:${stack.account}:parameter/DEV/${stack.stackName}/transcription-service/*`,
				],
			}),
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['cloudwatch:PutMetricData'],
				resources: ['*'],
			}),
		],
	});
};
