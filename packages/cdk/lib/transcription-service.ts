import { GuApiLambda } from '@guardian/cdk';
import { GuCertificate } from '@guardian/cdk/lib/constructs/acm';
import type { GuStackProps } from '@guardian/cdk/lib/constructs/core';
import {
	GuAmiParameter,
	GuDistributionBucketParameter,
	GuStack,
} from '@guardian/cdk/lib/constructs/core';
import { GuCname } from '@guardian/cdk/lib/constructs/dns';
import { GuVpc, SubnetType } from '@guardian/cdk/lib/constructs/ec2';
import { GuInstanceRole } from '@guardian/cdk/lib/constructs/iam';
import { GuardianAwsAccounts } from '@guardian/private-infrastructure-config';
import { type App, Duration } from 'aws-cdk-lib';
import { EndpointType } from 'aws-cdk-lib/aws-apigateway';
import {
	AutoScalingGroup,
	BlockDeviceVolume,
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

		apiLambda.addToRolePolicy(
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
				resources: [`${ssmPrefix}/${ssmPath}/*`],
			}),
		);

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

		// worker autoscaling group

		const workerApp = `${APP_NAME}-worker`;
		const userData = UserData.forLinux({ shebang: '#!/bin/bash' });
		// basic placeholder commands
		userData.addCommands(
			[
				`aws s3 cp s3://${GuDistributionBucketParameter.getInstance(this).valueAsString}/${props.stack}/${props.stage}/${workerApp}/worker.zip .`,
				`unzip worker.zip`,
				`node index.js`,
			].join('\n'),
		);

		const role = new GuInstanceRole(this, {
			app: workerApp,
		});

		const launchTemplate = new LaunchTemplate(
			this,
			'TranscriptionWorkerLaunchTemplate',
			{
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
						// assuming that we intend to support video files, 50GB seems a reasonable starting point (beyond that
						// the browser upload might struggle anyway)
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
				// instances should shut themselves down when they have finished the transcription - they should not be terminated
				// by the ASG
				newInstancesProtectedFromScaleIn: true,
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
		});

		// allow API lambda to write to queue
		transcriptionTaskQueue.grantSendMessages(apiLambda);

		// allow worker to receive message from queue
		transcriptionTaskQueue.grantConsumeMessages(transcriptionWorkerASG);
	}
}
