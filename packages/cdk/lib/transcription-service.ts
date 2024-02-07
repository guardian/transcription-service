import { GuApiLambda } from '@guardian/cdk';
import { GuCertificate } from '@guardian/cdk/lib/constructs/acm';
import type { GuStackProps } from '@guardian/cdk/lib/constructs/core';
import {
	GuAmiParameter,
	GuDistributionBucketParameter,
	GuStack,
	GuStringParameter,
} from '@guardian/cdk/lib/constructs/core';
import { GuCname } from '@guardian/cdk/lib/constructs/dns';
import { GuVpc, SubnetType } from '@guardian/cdk/lib/constructs/ec2';
import {
	GuAllowPolicy,
	GuInstanceRole,
	GuPolicy,
} from '@guardian/cdk/lib/constructs/iam';
import { GuS3Bucket } from '@guardian/cdk/lib/constructs/s3';
import { GuardianAwsAccounts } from '@guardian/private-infrastructure-config';
import { type App, Duration } from 'aws-cdk-lib';
import { EndpointType } from 'aws-cdk-lib/aws-apigateway';
import {
	AutoScalingGroup,
	BlockDeviceVolume,
	GroupMetrics,
	SpotAllocationStrategy,
} from 'aws-cdk-lib/aws-autoscaling';
import {
	InstanceClass,
	InstanceSize,
	InstanceType,
	LaunchTemplate,
	MachineImage,
	UserData,
} from 'aws-cdk-lib/aws-ec2';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Queue } from 'aws-cdk-lib/aws-sqs';

export class TranscriptionService extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		const APP_NAME = 'transcription-service';
		const apiId = `${APP_NAME}-${props.stage}`;
		const isProd = props.stage === 'PROD';
		if (!props.env?.region) throw new Error('region not provided in props');

		const workerAmi = new GuAmiParameter(this, {
			app: `${APP_NAME}-worker`,
			description: 'AMI to use for the worker instances',
		});

		const ssmPrefix = `arn:aws:ssm:${props.env.region}:${GuardianAwsAccounts.Investigations}:parameter`;
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
			},
		);

		sourceMediaBucket.addLifecycleRule({
			expiration: Duration.days(7),
		});

		// we only want one dev bucket so only create on CODE
		if (props.stage === 'CODE') {
			const sourceMediaBucketDev = new GuS3Bucket(
				this,
				'TranscriptionServiceUploadsBucket',
				{
					app: APP_NAME,
					bucketName: `transcription-service-source-media-dev`,
				},
			);
			sourceMediaBucketDev.addLifecycleRule({
				expiration: Duration.days(1),
			});
		}

		const apiLambda = new GuApiLambda(this, 'transcription-service-api', {
			fileName: 'api.zip',
			handler: 'index.api',
			runtime: Runtime.NODEJS_20_X,
			monitoringConfiguration: {
				noMonitoring: true,
			},
			app: APP_NAME,
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

		const getParametersPolicy = new PolicyStatement({
			effect: Effect.ALLOW,
			actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
			resources: [`${ssmPrefix}/${ssmPath}/*`],
		});

		apiLambda.addToRolePolicy(getParametersPolicy);

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
		const transcriptDestinationTopic = new Topic(
			this,
			'TranscriptDestinationTopic',
			{
				topicName: `transcription-service-destination-topic-${props.stage}`,
			},
		);

		// for testing purposes - probably eventually replaced with destination lambda. To avoid endless emails only apply
		// on PROD - we can manually set up subscriptions to specific developer emails in the console if needs be on CODE
		if (props.stage === 'PROD') {
			const destinationSNSTestEmail = new GuStringParameter(
				this,
				'DestinationSNSTestEmail',
				{
					fromSSM: true,
					default: `/${this.stage}/${this.stack}/${APP_NAME}/destinationSNSTestEmail`,
					description:
						'Email address to send SNS notifications to for testing purposes',
				},
			);
			const emailSubscription = new EmailSubscription(
				destinationSNSTestEmail.valueAsString,
			);
			transcriptDestinationTopic.addSubscription(emailSubscription);
		}

		// worker autoscaling group

		const workerApp = `${APP_NAME}-worker`;
		const userData = UserData.forLinux({ shebang: '#!/bin/bash' });
		// basic placeholder commands
		userData.addCommands(
			[
				`export STAGE=${props.stage}`,
				`export AWS_REGION=${props.env.region}`,
				`aws s3 cp s3://${GuDistributionBucketParameter.getInstance(this).valueAsString}/${props.stack}/${props.stage}/${workerApp}/transcription-service-worker_1.0.0_all.deb .`,
				`dpkg -i transcription-service-worker_1.0.0_all.deb`,
				`service transcription-service-worker start`,
			].join('\n'),
		);

		const role = new GuInstanceRole(this, {
			app: workerApp,
			additionalPolicies: [
				new GuPolicy(this, 'WorkerGetParameters', {
					statements: [getParametersPolicy],
				}),
				new GuAllowPolicy(this, 'GetDeleteSourceMedia', {
					actions: ['s3:GetObject', 's3:DeleteObject'],
					resources: [`${sourceMediaBucket.bucketArn}/*`],
				}),
				new GuAllowPolicy(this, 'WriteToDestinationTopic', {
					actions: ['sns:Publish'],
					resources: [transcriptDestinationTopic.topicArn],
				}),
			],
		});

		const launchTemplate = new LaunchTemplate(
			this,
			'TranscriptionWorkerLaunchTemplate',
			{
				machineImage: MachineImage.genericLinux({
					'eu-west-1': workerAmi.valueAsString,
				}),
				instanceType: InstanceType.of(InstanceClass.C7G, InstanceSize.XLARGE4),
				// include tags in instance metadata so that we can work out the STAGE
				instanceMetadataTags: true,
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
				userData,
				role: role,
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

		// unfortunately GuAutoscalingGroup doesn't support having a mixedInstancesPolicy so using the basic ASG here
		const transcriptionWorkerASG = new AutoScalingGroup(
			this,
			'TranscriptionWorkerASG',
			{
				minCapacity: 0,
				maxCapacity: isProd ? 20 : 4,
				autoScalingGroupName: `transcription-service-workers-${this.stage}`,
				vpc: GuVpc.fromIdParameter(this, 'InvestigationsInternetEnabledVpc', {
					availabilityZones: ['eu-west-1a', 'eu-west-1b', 'eu-west-1c'],
				}),
				vpcSubnets: {
					subnets: GuVpc.subnetsFromParameter(this, {
						type: SubnetType.PRIVATE,
						app: workerApp,
					}),
				},
				// we might want to set this to true once we are actually doing transcriptions to protect the instance from
				// being terminated before it has a chance to complete a transcription job.
				newInstancesProtectedFromScaleIn: false,
				mixedInstancesPolicy: {
					launchTemplate,
					instancesDistribution: {
						// 0 is the default, including this here just to make it more obvious what's happening
						onDemandBaseCapacity: 0,
						// if this value is set to 100, then we won't use spot instances at all, if it is 0 then we use 100% spot
						onDemandPercentageAboveBaseCapacity: 100,
						spotAllocationStrategy: SpotAllocationStrategy.CAPACITY_OPTIMIZED,
						spotMaxPrice: '0.6202',
					},
					launchTemplateOverrides: acceptableInstanceTypes.map(
						(instanceType) => ({
							instanceType,
						}),
					),
				},
				groupMetrics: [GroupMetrics.all()],
			},
		);

		// SQS queue for transcription tasks from API lambda to worker EC2 instances
		const transcriptionTaskQueue = new Queue(this, `${APP_NAME}-task-queue`, {
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
		});

		// allow API lambda to write to queue
		transcriptionTaskQueue.grantSendMessages(apiLambda);

		// allow worker to receive message from queue
		transcriptionTaskQueue.grantConsumeMessages(transcriptionWorkerASG);
	}
}
