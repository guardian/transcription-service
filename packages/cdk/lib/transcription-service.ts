import { GuApiLambda } from '@guardian/cdk';
import { GuCertificate } from '@guardian/cdk/lib/constructs/acm';
import type { GuStackProps } from '@guardian/cdk/lib/constructs/core';
import {
	GuAmiParameter,
	GuDistributionBucketParameter,
	GuLoggingStreamNameParameter,
	GuStack,
	GuStringParameter,
} from '@guardian/cdk/lib/constructs/core';
import { GuCname } from '@guardian/cdk/lib/constructs/dns';
import {
	GuSecurityGroup,
	GuVpc,
	SubnetType,
} from '@guardian/cdk/lib/constructs/ec2';
import { GuEcsTask } from '@guardian/cdk/lib/constructs/ecs';
import {
	GuAllowPolicy,
	GuInstanceRole,
	GuPolicy,
} from '@guardian/cdk/lib/constructs/iam';
import { GuLambdaFunction } from '@guardian/cdk/lib/constructs/lambda';
import { GuS3Bucket } from '@guardian/cdk/lib/constructs/s3';
import { MAX_RECEIVE_COUNT } from '@guardian/transcription-service-common';
import {
	type App,
	aws_events_targets,
	CfnOutput,
	Duration,
	Fn,
	RemovalPolicy,
	Size,
	Tags,
} from 'aws-cdk-lib';
import { EndpointType } from 'aws-cdk-lib/aws-apigateway';
import {
	AutoScalingGroup,
	BlockDeviceVolume,
	GroupMetrics,
	SpotAllocationStrategy,
} from 'aws-cdk-lib/aws-autoscaling';
import {
	Alarm,
	ComparisonOperator,
	Metric,
	TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import {
	InstanceClass,
	InstanceSize,
	InstanceType,
	LaunchTemplate,
	MachineImage,
	Peer,
	Port,
	SpotInstanceInterruption,
	UserData,
} from 'aws-cdk-lib/aws-ec2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import {
	Effect,
	PolicyStatement,
	Role,
	ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
	Architecture,
	Code,
	LayerVersion,
	Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import { Bucket, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { JsonPath } from 'aws-cdk-lib/aws-stepfunctions';

const topicArnToName = (topicArn: string) => {
	const split = topicArn.split(':');
	return split[split.length - 1] ?? '';
};

export class TranscriptionService extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		const APP_NAME = 'transcription-service';
		const apiId = `${APP_NAME}-${props.stage}`;
		const isProd = props.stage === 'PROD';
		const workerAutoscalingGroupName = `transcription-service-workers-${this.stage}`;
		const gpuWorkerAutoscalingGroupName = `transcription-service-gpu-workers-${this.stage}`;

		if (!props.env?.region) throw new Error('region not provided in props');

		const workerAmi = new GuAmiParameter(this, {
			app: `${APP_NAME}-worker`,
			description: 'AMI to use for the worker instances',
		});

		const gpuWorkerAmi = new GuAmiParameter(this, {
			app: `${APP_NAME}-gpu-worker`,
			description: 'AMI to use for the gpu worker instances',
		});

		const s3PrefixListId = new GuStringParameter(
			this,
			'S3PrefixListIdParameter',
			{
				fromSSM: true,
				default: `/${this.stage}/${this.stack}/${APP_NAME}/s3PrefixListId`,
				description:
					'ID of the managed prefix list for the S3 service. See https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html',
			},
		);

		const giantTranscriptionOutputQueueArn = new GuStringParameter(
			this,
			'GiantTranscriptionOutputQueueArn',
			{
				fromSSM: true,
				default: `/${props.stage}/investigations/GiantTranscriptionOutputQueueArn`,
			},
		).valueAsString;

		const ssmPrefix = `arn:aws:ssm:${props.env.region}:${this.account}:parameter`;
		const ssmPath = `${this.stage}/${this.stack}/${APP_NAME}`;
		const domainName =
			this.stage === 'PROD'
				? 'transcribe.gutools.co.uk'
				: 'transcribe.code.dev-gutools.co.uk';

		const certificate = new GuCertificate(this, {
			app: APP_NAME,
			domainName: domainName,
		});

		const sourceMediaBucket = new GuS3Bucket(
			this,
			'TranscriptionServiceSourceMediaBucket',
			{
				app: APP_NAME,
				bucketName: `transcription-service-source-media-${this.stage.toLowerCase()}`,
				cors: [
					{
						allowedOrigins: [`https://${domainName}`],
						allowedMethods: [HttpMethods.PUT],
					},
				],
				transferAcceleration: true,
			},
		);

		sourceMediaBucket.addLifecycleRule({
			expiration: Duration.days(7),
		});

		const outputBucket = new GuS3Bucket(
			this,
			'TranscriptionServiceOutputBucket',
			{
				app: APP_NAME,
				bucketName: `transcription-service-output-${this.stage.toLowerCase()}`,
			},
		);

		outputBucket.addLifecycleRule({
			expiration: Duration.days(7),
		});

		// we only want one dev bucket so only create on CODE
		if (props.stage === 'CODE') {
			const domainNameDev = 'transcribe.local.dev-gutools.co.uk';
			const sourceMediaBucketDev = new GuS3Bucket(
				this,
				'TranscriptionServiceUploadsBucket',
				{
					app: APP_NAME,
					bucketName: `transcription-service-source-media-dev`,
					cors: [
						{
							allowedOrigins: [`https://${domainNameDev}`],
							allowedMethods: [HttpMethods.PUT],
						},
					],
					transferAcceleration: true,
				},
			);
			sourceMediaBucketDev.addLifecycleRule({
				expiration: Duration.days(1),
			});

			const transcriptionOutputBucketDev = new GuS3Bucket(
				this,
				'TranscriptionServiceOutputsBucket',
				{
					app: APP_NAME,
					bucketName: `transcription-service-output-dev`,
				},
			);
			transcriptionOutputBucketDev.addLifecycleRule({
				expiration: Duration.days(7),
			});
		}

		const layerBucket = new GuStringParameter(this, 'LayerBucketArn', {
			fromSSM: true,
			default: '/investigations/transcription-service/lambdaLayerBucketArn',
		});

		const ffmpegHash = new GuStringParameter(this, 'FFMpegLayerZipKey', {
			description:
				"Key for the ffmpeg layer's zip file (pushed to layerBucket by publish-ffmpeg-layer.sh script)",
		});

		const ffmpegLayer = new LayerVersion(
			this,
			`FFMpegLayer_x86_64-${this.stage}`,
			{
				code: Code.fromBucket(
					Bucket.fromBucketArn(
						this,
						'LambdaLayerBucket',
						layerBucket.valueAsString,
					),
					ffmpegHash.valueAsString,
				),
				description: 'FFMpeg Layer',
				layerVersionName: 'FFMpegLayer',
				compatibleArchitectures: [Architecture.X86_64],
				compatibleRuntimes: [
					Runtime.NODEJS_LATEST,
					Runtime.NODEJS_22_X,
					Runtime.NODEJS_20_X,
					Runtime.NODEJS_18_X,
				],
			},
		);

		const apiLambda = new GuApiLambda(this, 'transcription-service-api', {
			fileName: 'api.zip',
			handler: 'index.api',
			runtime: Runtime.NODEJS_20_X,
			monitoringConfiguration: {
				noMonitoring: true,
			},
			app: `${APP_NAME}-api`,
			layers: [ffmpegLayer],
			ephemeralStorageSize: Size.gibibytes(10), // needed so api can download source files to get the duration
			api: {
				id: apiId,
				description: 'API for transcription service frontend',
				domainName: {
					certificate,
					domainName,
					endpointType: EndpointType.REGIONAL,
				},
			},
		});

		apiLambda.role?.attachInlinePolicy(
			new GuPolicy(this, 'LambdaMediaUploadBucketInlinePolicy', {
				statements: [
					new PolicyStatement({
						effect: Effect.ALLOW,
						actions: ['s3:GetObject', 's3:PutObject'],
						resources: [`${sourceMediaBucket.bucketArn}/*`],
					}),
				],
			}),
		);

		apiLambda.role?.attachInlinePolicy(
			new GuPolicy(this, 'LambdaOutputBucketInlinePolicy', {
				statements: [
					new PolicyStatement({
						effect: Effect.ALLOW,
						actions: ['s3:PutObject', 's3:GetObject'],
						resources: [`${outputBucket.bucketArn}/*`],
					}),
				],
			}),
		);

		const getParametersPolicy = new PolicyStatement({
			effect: Effect.ALLOW,
			actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
			resources: [`${ssmPrefix}/${ssmPath}/*`],
		});

		const putMetricDataPolicy = new PolicyStatement({
			effect: Effect.ALLOW,
			actions: ['cloudwatch:PutMetricData'],
			resources: ['*'],
		});

		apiLambda.addToRolePolicy(getParametersPolicy);
		apiLambda.addToRolePolicy(putMetricDataPolicy);

		// The custom domain name mapped to this API
		const apiDomain = apiLambda.api.domainName;
		if (!apiDomain) throw new Error('api lambda domainName is undefined');

		// CNAME mapping between API Gateway and the custom
		new GuCname(this, 'transcription DNS entry', {
			app: APP_NAME,
			domainName,
			ttl: Duration.hours(1),
			resourceRecord: apiDomain.domainNameAliasDomainName,
		});

		// worker output infrastructure
		const transcriptionOutputQueue = new Queue(
			this,
			`${APP_NAME}-output-queue`,
			{
				queueName: `${APP_NAME}-output-queue-${this.stage}`,
			},
		);

		// worker autoscaling group

		const workerApp = `${APP_NAME}-worker`;
		const userData = UserData.forLinux({ shebang: '#!/bin/bash' });

		const userDataCommands = [
			`export STAGE=${props.stage}`,
			`export AWS_REGION=${props.env.region}`,
			`aws s3 cp s3://${GuDistributionBucketParameter.getInstance(this).valueAsString}/${props.stack}/${props.stage}/${workerApp}/transcription-service-worker_1.0.0_all.deb .`,
			`dpkg -i transcription-service-worker_1.0.0_all.deb`,
			`service transcription-service-worker start`,
		].join('\n');

		userData.addCommands(userDataCommands);

		const loggingStreamName =
			GuLoggingStreamNameParameter.getInstance(this).valueAsString;

		const loggingStreamArn = this.formatArn({
			service: 'kinesis',
			resource: 'stream',
			resourceName: loggingStreamName,
		});

		const workerRole = new GuInstanceRole(this, {
			app: workerApp,
			additionalPolicies: [
				new GuPolicy(this, 'WorkerGetParameters', {
					statements: [getParametersPolicy],
				}),
				new GuAllowPolicy(this, 'WriteToDestinationTopic', {
					actions: ['sqs:SendMessage'],
					resources: [
						transcriptionOutputQueue.queueArn,
						giantTranscriptionOutputQueueArn,
					],
				}),
				new GuAllowPolicy(this, 'WriteToELK', {
					actions: [
						'kinesis:DescribeStream',
						'kinesis:PutRecord',
						'kinesis:PutRecords',
					],
					resources: [loggingStreamArn],
				}),
				new GuAllowPolicy(this, 'SetInstanceProtection', {
					actions: ['autoscaling:SetInstanceProtection'],
					resources: [
						`arn:aws:autoscaling:${props.env.region}:${this.account}:autoScalingGroup:*:autoScalingGroupName/${workerAutoscalingGroupName}`,
						`arn:aws:autoscaling:${props.env.region}:${this.account}:autoScalingGroup:*:autoScalingGroupName/${gpuWorkerAutoscalingGroupName}`,
					],
				}),
				new GuAllowPolicy(this, 'WriteCloudwatch', {
					actions: ['cloudwatch:PutMetricData'],
					resources: ['*'],
				}),
			],
		});
		const vpc = GuVpc.fromIdParameter(
			this,
			'InvestigationsInternetEnabledVpc',
			{
				availabilityZones: ['eu-west-1a', 'eu-west-1b', 'eu-west-1c'],
			},
		);

		const workerSecurityGroup = new GuSecurityGroup(
			this,
			`TranscriptionServiceWorkerSG`,
			{
				app: workerApp,
				vpc,
				allowAllOutbound: false,
			},
		);

		const privateEndpointSecurityGroup = Fn.importValue(
			`internet-enabled-vpc-AWSEndpointSecurityGroup`,
		);

		workerSecurityGroup.addEgressRule(
			Peer.securityGroupId(privateEndpointSecurityGroup),
			Port.tcp(443),
		);

		workerSecurityGroup.addEgressRule(
			Peer.prefixList(s3PrefixListId.valueAsString),
			Port.tcp(443),
		);

		const commonLaunchTemplateProps = {
			// include tags in instance metadata so that we can work out the STAGE
			instanceMetadataTags: true,
			userData,
			role: workerRole,
			requireImdsv2: true,
			securityGroup: workerSecurityGroup,
		};

		const cpuWorkerLaunchTemplate = new LaunchTemplate(
			this,
			'TranscriptionWorkerLaunchTemplate',
			{
				...commonLaunchTemplateProps,
				machineImage: MachineImage.genericLinux({
					'eu-west-1': workerAmi.valueAsString,
				}),
				instanceType: InstanceType.of(InstanceClass.C7G, InstanceSize.XLARGE4),
				// the size of this block device will determine the max input file size for transcription. In future we could
				// attach the block device on startup once we know how large the file to be transcribed is, or try some kind
				// of streaming approach to the transcription so we don't need the whole file on disk
				blockDevices: [
					{
						deviceName: '/dev/sda1',
						// assuming that we intend to support video files, 50GB seems a reasonable starting point
						volume: BlockDeviceVolume.ebs(50),
					},
				],
			},
		);

		const gpuWorkerLaunchTemplate = new LaunchTemplate(
			this,
			'TranscriptionWorkerGPULaunchTemplate',
			{
				...commonLaunchTemplateProps,
				machineImage: MachineImage.genericLinux({
					'eu-west-1': gpuWorkerAmi.valueAsString,
				}),
				instanceType: InstanceType.of(InstanceClass.G4DN, InstanceSize.XLARGE),
				blockDevices: [
					{
						deviceName: '/dev/sda1',
						// The AMI with the nvidia cuda drivers and whisperx installed is enormous
						volume: BlockDeviceVolume.ebs(100),
					},
				],
			},
		);

		// instance types we are happy to use for workers. Note - order matters as when launching 'on demand' instances
		// the ASG will start at the top of the list and work down until it manages to launch an instance
		const acceptableInstanceTypes = isProd
			? [
					InstanceType.of(InstanceClass.C7G, InstanceSize.XLARGE4),
					InstanceType.of(InstanceClass.C6G, InstanceSize.XLARGE4),
					InstanceType.of(InstanceClass.M7G, InstanceSize.XLARGE4),
					InstanceType.of(InstanceClass.C7G, InstanceSize.XLARGE8),
					InstanceType.of(InstanceClass.C6G, InstanceSize.XLARGE8),
				]
			: [InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM)];

		const gpuInstanceTypes = isProd
			? [
					InstanceType.of(InstanceClass.G4DN, InstanceSize.XLARGE),
					InstanceType.of(InstanceClass.G4DN, InstanceSize.XLARGE2),
					InstanceType.of(InstanceClass.G5, InstanceSize.XLARGE),
				]
			: [InstanceType.of(InstanceClass.G4DN, InstanceSize.XLARGE)];

		const guSubnets = GuVpc.subnetsFromParameter(this, {
			type: SubnetType.PRIVATE,
			app: workerApp,
		});

		const instanceTypeToOverride = (instanceType: InstanceType) => ({
			instanceType,
			spotOptions: {
				interruptionBehavior: SpotInstanceInterruption.TERMINATE,
			},
		});

		const commonAsgProps = {
			minCapacity: 0,
			maxCapacity: isProd ? 20 : 4,
			vpc,
			vpcSubnets: {
				subnets: guSubnets,
			},
			groupMetrics: [GroupMetrics.all()],
		};

		const commonInstancesDistributionprops = {
			// 0 is the default, including this here just to make it more obvious what's happening
			onDemandBaseCapacity: 0,
			// if this value is set to 100, then we won't use spot instances at all, if it is 0 then we use 100% spot
			onDemandPercentageAboveBaseCapacity: 10,
			spotAllocationStrategy: SpotAllocationStrategy.CAPACITY_OPTIMIZED,
		};

		// unfortunately GuAutoscalingGroup doesn't support having a mixedInstancesPolicy so using the basic ASG here
		const transcriptionWorkerASG = new AutoScalingGroup(
			this,
			'TranscriptionWorkerASG',
			{
				...commonAsgProps,
				autoScalingGroupName: workerAutoscalingGroupName,
				mixedInstancesPolicy: {
					launchTemplate: cpuWorkerLaunchTemplate,
					instancesDistribution: {
						...commonInstancesDistributionprops,
						spotMaxPrice: '0.6202',
					},
					launchTemplateOverrides: acceptableInstanceTypes.map(
						instanceTypeToOverride,
					),
				},
			},
		);

		const transcriptionGpuWorkerASG = new AutoScalingGroup(
			this,
			'TranscriptionGpuWorkerASG',
			{
				...commonAsgProps,
				autoScalingGroupName: gpuWorkerAutoscalingGroupName,
				mixedInstancesPolicy: {
					launchTemplate: gpuWorkerLaunchTemplate,
					instancesDistribution: {
						...commonInstancesDistributionprops,
						spotMaxPrice: '0.5260',
					},
					launchTemplateOverrides: gpuInstanceTypes.map(instanceTypeToOverride),
				},
			},
		);

		Tags.of(transcriptionWorkerASG).add(
			'LogKinesisStreamName',
			GuLoggingStreamNameParameter.getInstance(this).valueAsString,
			{ applyToLaunchedInstances: true },
		);

		Tags.of(transcriptionGpuWorkerASG).add(
			'LogKinesisStreamName',
			GuLoggingStreamNameParameter.getInstance(this).valueAsString,
			{ applyToLaunchedInstances: true },
		);

		Tags.of(transcriptionWorkerASG).add('SystemdUnit', `${workerApp}.service`, {
			applyToLaunchedInstances: true,
		});

		Tags.of(transcriptionWorkerASG).add('App', `transcription-service-worker`, {
			applyToLaunchedInstances: true,
		});

		Tags.of(transcriptionGpuWorkerASG).add(
			'SystemdUnit',
			`${workerApp}.service`,
			{
				applyToLaunchedInstances: true,
			},
		);

		Tags.of(transcriptionGpuWorkerASG).add(
			'App',
			`transcription-service-gpu-worker`,
			{
				applyToLaunchedInstances: true,
			},
		);

		const transcriptionDeadLetterQueue = new Queue(
			this,
			`${APP_NAME}-task-dead-letter-queue`,
			{
				fifo: true,
				queueName: `${APP_NAME}-task-dead-letter-queue-${this.stage}.fifo`,
				contentBasedDeduplication: true,
			},
		);

		// SQS queue for transcription tasks from API lambda to worker EC2 instances
		const taskQueueProps = {
			fifo: true,
			queueName: `${APP_NAME}-task-queue-${this.stage}.fifo`,
			// this is the default. 30 seconds should be enough time to get the
			// size of the file from s3 and estimate transcription time. If it's
			// not, we'll need to increase visibilityTimeout
			visibilityTimeout: Duration.seconds(30),
			// contentBasedDeduplication takes a sha-256 hash of the message body to use as the deduplication ID. In future
			// we might choose to use a hash of the actual file to be transcribed instead (but I can't really think where
			// that would be particularly helpful)
			contentBasedDeduplication: true,
			deadLetterQueue: {
				queue: transcriptionDeadLetterQueue,
				maxReceiveCount: MAX_RECEIVE_COUNT,
			},
		};
		const transcriptionTaskQueue = new Queue(
			this,
			`${APP_NAME}-task-queue`,
			taskQueueProps,
		);

		const transcriptionGpuTaskQueue = new Queue(
			this,
			`${APP_NAME}-gpu-task-queue`,
			{
				...taskQueueProps,
				queueName: `${APP_NAME}-gpu-task-queue-${this.stage}.fifo`,
			},
		);
		new StringParameter(this, 'GPUTaskQueueUrlParameter', {
			parameterName: `/${ssmPath}/gpuTaskQueueUrl`,
			stringValue: transcriptionGpuTaskQueue.queueUrl,
		});

		// allow API lambda to write to queue
		transcriptionTaskQueue.grantSendMessages(apiLambda);
		transcriptionGpuTaskQueue.grantSendMessages(apiLambda);

		// allow worker to receive message from queue
		transcriptionTaskQueue.grantConsumeMessages(transcriptionWorkerASG);
		transcriptionGpuTaskQueue.grantConsumeMessages(transcriptionGpuWorkerASG);

		// allow worker to write messages to the dead letter queue
		transcriptionDeadLetterQueue.grantSendMessages(transcriptionWorkerASG);
		transcriptionDeadLetterQueue.grantSendMessages(transcriptionGpuWorkerASG);

		const mediaDownloadDeadLetterQueue = new Queue(
			this,
			`${APP_NAME}-media-download-dead-letter-queue`,
			{
				fifo: true,
				queueName: `${APP_NAME}-media-download-dead-letter-queue-${this.stage}.fifo`,
				contentBasedDeduplication: true,
			},
		);

		// SQS queue for media download tasks from API lambda to media-download service
		const mediaDownloadTaskQueue = new Queue(
			this,
			`${APP_NAME}-media-download-task-queue`,
			{
				fifo: true,
				queueName: `${APP_NAME}-media-download-task-queue-${this.stage}.fifo`,
				visibilityTimeout: Duration.seconds(30),
				contentBasedDeduplication: true,
				deadLetterQueue: {
					queue: mediaDownloadDeadLetterQueue,
					maxReceiveCount: MAX_RECEIVE_COUNT,
				},
			},
		);

		mediaDownloadTaskQueue.grantSendMessages(apiLambda);

		const mediaDownloadApp = 'media-download';

		const sshKeySecret = new Secret(this, 'media-download-ssh-key', {
			secretName: `media-download-ssh-key-${this.stage}`,
		});

		const alarmTopicArn = new GuStringParameter(
			this,
			'InvestigationsAlarmTopicArn',
			{
				fromSSM: true,
				default: `/${props.stage}/investigations/alarmTopicArn`,
			},
		).valueAsString;

		const alarmTopicName = topicArnToName(alarmTopicArn);

		const mediaDownloadTask = new GuEcsTask(this, 'media-download-task', {
			app: mediaDownloadApp,
			vpc,
			subnets: GuVpc.subnetsFromParameterFixedNumber(
				this,
				{
					type: SubnetType.PRIVATE,
					app: mediaDownloadApp,
				},
				3,
			),
			containerConfiguration: {
				repository: Repository.fromRepositoryName(
					this,
					'MediaDownloadRepository',
					`transcription-service-${mediaDownloadApp}`,
				),
				type: 'repository',
				version: process.env['CONTAINER_VERSION'] ?? 'main',
			},
			taskTimeoutInMinutes: 120,
			monitoringConfiguration:
				this.stage === 'PROD'
					? {
							noMonitoring: false,
							snsTopicArn: alarmTopicArn,
						}
					: { noMonitoring: true },
			securityGroups: [
				new GuSecurityGroup(this, 'media-download-sg', {
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
					value: this.region,
				},
				{
					name: 'STAGE',
					value: this.stage,
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
		mediaDownloadTask.taskDefinition.addVolume(downloadVolume);
		mediaDownloadTask.taskDefinition.addVolume(tempVolume);
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

		const pipeRole = new Role(this, 'eventbridge-pipe-role', {
			assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
		});

		new GuAllowPolicy(this, 'sqs-read', {
			actions: [
				'sqs:ReceiveMessage',
				'sqs:DeleteMessage',
				'sqs:GetQueueAttributes',
			],
			resources: [mediaDownloadTaskQueue.queueArn],
			roles: [pipeRole],
		});
		new GuAllowPolicy(this, 'sfn-start', {
			actions: ['states:StartExecution'],
			resources: [mediaDownloadTask.stateMachine.stateMachineArn],
			roles: [pipeRole],
		});
		const logGroup = new LogGroup(this, 'media-download-queue-sfn-pipe-log', {
			logGroupName: `/aws/pipes/${this.stage}/media-download-queue-sfn-pipe`,
			retention: 7,
			removalPolicy: RemovalPolicy.SNAPSHOT,
		});

		new CfnPipe(this, 'media-download-sqs-sfn', {
			source: mediaDownloadTaskQueue.queueArn,
			target: mediaDownloadTask.stateMachine.stateMachineArn,
			targetParameters: {
				stepFunctionStateMachineParameters: {
					invocationType: 'FIRE_AND_FORGET',
				},
			},
			roleArn: pipeRole.roleArn,
			name: `media-download-queue-sfn-pipe-${this.stage}`,
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

		const transcriptTable = new Table(this, 'TranscriptTable', {
			tableName: `${APP_NAME}-${this.stage}`,
			partitionKey: {
				name: 'id',
				type: AttributeType.STRING,
			},
			readCapacity: 1,
			writeCapacity: 1,
		});

		// Enable nightly backups (via https://github.com/guardian/aws-backup)
		Tags.of(transcriptTable).add('devx-backup-enabled', 'true');

		const outputHandlerLambda = new GuLambdaFunction(
			this,
			'transcription-service-output-handler',
			{
				fileName: 'output-handler.zip',
				handler: 'index.outputHandler',
				runtime: Runtime.NODEJS_20_X,
				app: `${APP_NAME}-output-handler`,
				errorPercentageMonitoring:
					this.stage === 'PROD'
						? {
								toleratedErrorPercentage: 0,
								noMonitoring: false,
								snsTopicName: alarmTopicName,
							}
						: undefined,
			},
		);

		transcriptTable.grantReadWriteData(outputHandlerLambda);
		transcriptTable.grantReadWriteData(apiLambda);

		// trigger output-handler lambda from queue
		outputHandlerLambda.addEventSource(
			new SqsEventSource(transcriptionOutputQueue),
		);

		outputHandlerLambda.addToRolePolicy(
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['ses:SendEmail', 'ses:SendRawEmail'],
				resources: ['*'],
			}),
		);

		outputHandlerLambda.addToRolePolicy(
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['s3:GetObject'],
				resources: [
					`${outputBucket.bucketArn}/*`,
					`${sourceMediaBucket.bucketArn}/*`,
				],
			}),
		);

		outputHandlerLambda.addToRolePolicy(getParametersPolicy);
		outputHandlerLambda.addToRolePolicy(putMetricDataPolicy);

		const mediaExportLambda = new GuLambdaFunction(
			this,
			'transcription-service-media-export',
			{
				fileName: 'media-export.zip',
				handler: 'index.mediaExport',
				runtime: Runtime.NODEJS_20_X,
				app: `${APP_NAME}-media-export`,
				ephemeralStorageSize: Size.mebibytes(10240),
				memorySize: 2048,
				timeout: Duration.seconds(900),
				errorPercentageMonitoring:
					this.stage === 'PROD'
						? {
								toleratedErrorPercentage: 0,
								noMonitoring: false,
								snsTopicName: alarmTopicName,
							}
						: undefined,
			},
		);

		new StringParameter(this, 'ExportFunctionName', {
			parameterName: `/${ssmPath}/app/mediaExportFunctionName`,
			stringValue: mediaExportLambda.functionName,
		});

		mediaExportLambda.addToRolePolicy(getParametersPolicy);
		mediaExportLambda.addToRolePolicy(
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['s3:GetObject'],
				resources: [`${sourceMediaBucket.bucketArn}/*`],
			}),
		);
		transcriptTable.grantReadWriteData(mediaExportLambda);
		mediaExportLambda.grantInvoke(apiLambda);

		new CfnOutput(this, 'WorkerRoleArn', {
			exportName: `WorkerRoleArn-${props.stage}`,
			value: workerRole.roleArn,
		});

		const workerCapacityManagerLambda = new GuLambdaFunction(
			this,
			'transcription-service-worker-capacity-manager',
			{
				fileName: 'worker-capacity-manager.zip',
				handler: 'index.workerCapacityManager',
				runtime: Runtime.NODEJS_20_X,
				app: `${APP_NAME}-worker-capacity-manager`,
			},
		);

		workerCapacityManagerLambda.addToRolePolicy(
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: [
					'autoscaling:SetDesiredCapacity',
					'autoscaling:DescribeAutoScalingInstances',
				],
				resources: [
					transcriptionWorkerASG.autoScalingGroupArn,
					transcriptionGpuWorkerASG.autoScalingGroupArn,
				],
			}),
		);

		workerCapacityManagerLambda.addToRolePolicy(
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['autoscaling:DescribeAutoScalingGroups'],
				resources: ['*'],
			}),
		);

		workerCapacityManagerLambda.addToRolePolicy(
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['sqs:GetQueueAttributes'],
				resources: [
					transcriptionTaskQueue.queueArn,
					transcriptionGpuTaskQueue.queueArn,
				],
			}),
		);

		workerCapacityManagerLambda.addToRolePolicy(getParametersPolicy);

		new Rule(this, 'worker-capacity-manager-rule', {
			description:
				'Manages worker capacity by updating the desired capacity of ASG based on queue length',
			targets: [
				new aws_events_targets.LambdaFunction(workerCapacityManagerLambda),
			],
			schedule: Schedule.rate(Duration.minutes(1)),
		});

		// alarms

		if (isProd) {
			const alarms = [
				// alarm when a message is added to the dead letter queue
				// note that queue metrics go to 'sleep' if it is empty for more than 6 hours, so it may take up to 16 minutes
				// for this alarm to trigger - see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-monitoring-using-cloudwatch.html
				new Alarm(this, 'DeadLetterQueueAlarm', {
					alarmName: `transcription-service-dead-letter-queue-${props.stage}`,
					metric:
						transcriptionDeadLetterQueue.metricApproximateNumberOfMessagesVisible(
							{ period: Duration.minutes(1), statistic: 'max' },
						),
					threshold: 1,
					evaluationPeriods: 1,
					actionsEnabled: true,
					alarmDescription: `A transcription job has been sent to the dead letter queue. This may be because ffmpeg can't convert the file (maybe it's a JPEG) or because the transcription job has failed multiple times.`,
					treatMissingData: TreatMissingData.IGNORE,
					comparisonOperator:
						ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
				}),
				// alarm when failure metric is greater than 0
				new Alarm(this, 'FailureAlarm', {
					alarmName: `transcription-service-failure-${props.stage}`,
					//  reference the custom metric created in metrics.ts library
					metric: new Metric({
						namespace: 'TranscriptionService',
						metricName: 'Failure',
						dimensionsMap: {
							Stage: props.stage,
						},
						statistic: 'sum',
						period: Duration.minutes(1),
					}),
					threshold: 1,
					comparisonOperator:
						ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
					evaluationPeriods: 1,
					actionsEnabled: true,
					alarmDescription: 'A transcription service failure has occurred',
					treatMissingData: TreatMissingData.IGNORE,
				}),
				// alarm when at least one instance has been running in the worker asg during every 5 minute period for
				// more than 12 hours
				new Alarm(this, 'WorkerInstanceAlarm', {
					alarmName: `transcription-service-worker-instances-${props.stage}`,
					// this doesn't actually create the metric - just a reference to it
					metric: new Metric({
						namespace: 'AWS/AutoScaling',
						metricName: 'GroupTotalInstances',
						dimensionsMap: {
							AutoScalingGroupName: transcriptionWorkerASG.autoScalingGroupName,
						},
						statistic: 'min',
						period: Duration.minutes(5),
					}),
					threshold: 1,
					comparisonOperator:
						ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
					evaluationPeriods: 12 * 12, // 12 hours as metric has period of 5 minutes
					actionsEnabled: true,
					alarmDescription: `There has been at least 1 worker instance running for 12 hours.
						This could mean that a worker is failing to be scaled in, which could have significant cost implications.
						Please check that all running workers are doing something useful.`,
					treatMissingData: TreatMissingData.IGNORE,
				}),
			];
			const snsAction = new SnsAction(
				Topic.fromTopicArn(this, 'TranscriptionAlarmTopic', alarmTopicArn),
			);
			alarms.forEach((alarm) => {
				alarm.addAlarmAction(snsAction);
			});
		}
	}
}
