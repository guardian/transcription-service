import type { GuStack } from '@guardian/cdk/lib/constructs/core';
import { GuStringParameter } from '@guardian/cdk/lib/constructs/core';
import {
	GuSecurityGroup,
	GuVpc,
	SubnetType,
} from '@guardian/cdk/lib/constructs/ec2';
import { GuEcsTask } from '@guardian/cdk/lib/constructs/ecs';
import { GuAllowPolicy } from '@guardian/cdk/lib/constructs/iam';
import type { GuLambdaFunction } from '@guardian/cdk/lib/constructs/lambda';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type { IVpc } from 'aws-cdk-lib/aws-ec2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { ContainerInsights } from 'aws-cdk-lib/aws-ecs';
import {
	Effect,
	PolicyStatement,
	Role,
	ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import type { Bucket } from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Topic } from 'aws-cdk-lib/aws-sns';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { JsonPath } from 'aws-cdk-lib/aws-stepfunctions';
import { addSubscription } from './util';

export const makeMediaDownloadService = (
	scope: GuStack,
	vpc: IVpc,
	APP_NAME: string,
	apiLambda: GuLambdaFunction,
	alarmTopicArn: string,
	transcriptionTaskQueue: Queue,
	transcriptionGpuTaskQueue: Queue,
	transcriptionOutputQueue: Queue,
	sourceMediaBucket: Bucket,
	outputBucket: Bucket,
	getParametersPolicy: PolicyStatement,
	combinedTaskTopic: Topic,
) => {
	const mediaDownloadGiantOutputQueueArn = new GuStringParameter(
		scope,
		'mediaDownloadGiantOutputQueueArn',
		{
			fromSSM: true,
			default: `/${scope.stage}/investigations/transcription-service/mediaDownloadGiantOutputQueueArn`,
		},
	).valueAsString;

	const mediaDownloadDeadLetterQueue = new Queue(
		scope,
		`${APP_NAME}-media-download-dead-letter-queue`,
		{
			queueName: `${APP_NAME}-media-download-dead-letter-queue-${scope.stage}`,
		},
	);

	// SQS queue for media download tasks from API lambda to media-download service
	const mediaDownloadTaskQueue = new Queue(
		scope,
		`${APP_NAME}-media-download-task-queue`,
		{
			queueName: `${APP_NAME}-media-download-task-queue-${scope.stage}`,
			visibilityTimeout: Duration.seconds(30),
			deadLetterQueue: {
				queue: mediaDownloadDeadLetterQueue,
				maxReceiveCount: MAX_RECEIVE_COUNT,
			},
		},
	);

	addSubscription(
		scope,
		'MediaDownload',
		mediaDownloadTaskQueue,
		combinedTaskTopic,
	);

	mediaDownloadTaskQueue.grantSendMessages(apiLambda);

	const mediaDownloadApp = 'media-download';

	const sshKeySecret = new Secret(scope, 'media-download-ssh-key', {
		secretName: `media-download-ssh-key-${scope.stage}`,
	});

	const mediaDownloadTask = new GuEcsTask(scope, 'media-download-task', {
		app: mediaDownloadApp,
		vpc,
		subnets: GuVpc.subnetsFromParameterFixedNumber(
			scope,
			{
				type: SubnetType.PRIVATE,
				app: mediaDownloadApp,
			},
			3,
		),
		containerInsights: ContainerInsights.DISABLED,
		containerConfiguration: {
			repository: Repository.fromRepositoryName(
				scope,
				'MediaDownloadRepository',
				`transcription-service-${mediaDownloadApp}`,
			),
			type: 'repository',
			version: process.env['CONTAINER_VERSION'] ?? 'main',
		},
		taskTimeoutInMinutes: 120,
		monitoringConfiguration:
			scope.stage === 'PROD'
				? {
						noMonitoring: false,
						snsTopicArn: alarmTopicArn,
					}
				: { noMonitoring: true },
		securityGroups: [
			new GuSecurityGroup(scope, 'media-download-sg', {
				vpc,
				allowAllOutbound: true,
				app: mediaDownloadApp,
			}),
		],
		customTaskPolicies: [
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['sqs:ReceiveMessage'],
				resources: [mediaDownloadTaskQueue.queueArn],
			}),
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['sqs:SendMessage'],
				resources: [
					transcriptionTaskQueue.queueArn,
					transcriptionGpuTaskQueue.queueArn,
					transcriptionOutputQueue.queueArn,
					mediaDownloadGiantOutputQueueArn,
				],
			}),
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['secretsmanager:GetSecretValue'],
				resources: [sshKeySecret.secretArn],
			}),
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['s3:PutObject'],
				resources: [`${outputBucket.bucketArn}/*`],
			}),
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['s3:PutObject', 's3:GetObject'],
				resources: [`${sourceMediaBucket.bucketArn}/downloaded-media/*`],
			}),
			getParametersPolicy,
		],
		storage: 50,
		enableDistributablePolicy: false,
		environmentOverrides: [
			{
				name: 'MESSAGE_BODY',
				value: JsonPath.stringAt('$[0].body'),
			},
			{
				name: 'AWS_REGION',
				value: scope.region,
			},
			{
				name: 'STAGE',
				value: scope.stage,
			},
			{
				name: 'APP',
				value: mediaDownloadApp,
			},
		],
	});

	const downloadVolume = {
		name: `${mediaDownloadApp}-download-volume`,
	};
	const tempVolume = {
		name: `${mediaDownloadApp}-temp-volume`,
	};
	const cacheVolume = {
		name: `${mediaDownloadApp}-cache-volume`,
	};
	const sshVolume = {
		name: `${mediaDownloadApp}-ssh-volume`,
	};
	mediaDownloadTask.taskDefinition.addVolume(downloadVolume);
	mediaDownloadTask.taskDefinition.addVolume(tempVolume);
	mediaDownloadTask.taskDefinition.addVolume(cacheVolume);
	mediaDownloadTask.taskDefinition.addVolume(sshVolume);
	mediaDownloadTask.containerDefinition.addMountPoints({
		sourceVolume: downloadVolume.name,
		containerPath: '/media-download', // needs to match ECS_MEDIA_DOWNLOAD_WORKING_DIRECTORY in media-download index.ts
		readOnly: false,
	});
	mediaDownloadTask.containerDefinition.addMountPoints({
		sourceVolume: tempVolume.name,
		containerPath: '/tmp', // needed by yt-dlp
		readOnly: false,
	});
	mediaDownloadTask.containerDefinition.addMountPoints({
		sourceVolume: cacheVolume.name,
		containerPath: '/root/.cache', // needed by yt-dlp
		readOnly: false,
	});
	mediaDownloadTask.containerDefinition.addMountPoints({
		sourceVolume: sshVolume.name,
		containerPath: '/root/.ssh',
		readOnly: false,
	});

	const pipeRole = new Role(scope, 'eventbridge-pipe-role', {
		assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
	});

	new GuAllowPolicy(scope, 'sqs-read', {
		actions: [
			'sqs:ReceiveMessage',
			'sqs:DeleteMessage',
			'sqs:GetQueueAttributes',
		],
		resources: [mediaDownloadTaskQueue.queueArn],
		roles: [pipeRole],
	});
	new GuAllowPolicy(scope, 'sfn-start', {
		actions: ['states:StartExecution'],
		resources: [mediaDownloadTask.stateMachine.stateMachineArn],
		roles: [pipeRole],
	});
	const logGroup = new LogGroup(scope, 'media-download-queue-sfn-pipe-log', {
		logGroupName: `/aws/pipes/${scope.stage}/media-download-queue-sfn-pipe`,
		retention: 7,
		removalPolicy: RemovalPolicy.SNAPSHOT,
	});

	new CfnPipe(scope, 'media-download-sqs-sfn', {
		source: mediaDownloadTaskQueue.queueArn,
		target: mediaDownloadTask.stateMachine.stateMachineArn,
		targetParameters: {
			stepFunctionStateMachineParameters: {
				invocationType: 'FIRE_AND_FORGET',
			},
		},
		roleArn: pipeRole.roleArn,
		name: `media-download-state-machine-pipe-${scope.stage}`,
		desiredState: 'RUNNING',
		logConfiguration: {
			cloudwatchLogsLogDestination: {
				logGroupArn: logGroup.logGroupArn,
			},
			level: 'INFO',
		},
		sourceParameters: {
			sqsQueueParameters: {
				batchSize: 1,
			},
		},
		description:
			'Pipe to trigger the media download service from the associated SQS queue.',
	});
};
