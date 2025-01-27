import type { GuStackProps } from '@guardian/cdk/lib/constructs/core';
import { GuStack, GuStringParameter } from '@guardian/cdk/lib/constructs/core';
import type { App } from 'aws-cdk-lib';
import { CfnOutput, Fn, RemovalPolicy } from 'aws-cdk-lib';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import {
	AccountPrincipal,
	ArnPrincipal,
	Effect,
	PolicyDocument,
	PolicyStatement,
	Role,
} from 'aws-cdk-lib/aws-iam';

export class TranscriptionServiceRepository extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);
		const githubActionsIAMRoleArn = new GuStringParameter(
			this,
			'GithubActionsIAMRoleArn',
			{
				description: 'IAM role for role used by github actions workflows',
			},
		);
		const deployToolsAccountNumber = new GuStringParameter(
			this,
			'DeployToolsAccount',
			{
				description:
					'Deploy tools account id - needed to give AMIgo access to this repository',
			},
		);
		const transcriptionRepository = new Repository(
			this,
			'TranscriptionServiceRepository',
			{
				repositoryName: `transcription-service`,
				lifecycleRules: [
					{
						maxImageCount: 5,
					},
				],
				imageTagMutability: TagMutability.MUTABLE,
				removalPolicy: RemovalPolicy.DESTROY,
				imageScanOnPush: true,
			},
		);

		const mediaDownloadRepository = new Repository(
			this,
			'MediaDownloadRepository',
			{
				repositoryName: `transcription-service-media-download`,
				lifecycleRules: [
					{
						tagPrefixList: ['main'],
						maxImageCount: undefined,
						rulePriority: 1,
					},
					{
						maxImageCount: 10,
						rulePriority: 2,
					},
				],
				imageTagMutability: TagMutability.MUTABLE,
				removalPolicy: RemovalPolicy.DESTROY,
				imageScanOnPush: true,
			},
		);
		// allow transcription workers read access to the repo
		const workerReadPolicyStatement = new PolicyStatement({
			principals: [
				new ArnPrincipal(Fn.importValue(`WorkerRoleArn-CODE`)),
				new ArnPrincipal(Fn.importValue(`WorkerRoleArn-PROD`)),
			],
			actions: [
				'ecr:GetAuthorizationToken',
				'ecr:BatchCheckLayerAvailability',
				'ecr:GetDownloadUrlForLayer',
				'ecr:GetRepositoryPolicy',
				'ecr:ListImages',
				'ecr:DescribeImages',
				'ecr:BatchGetImage',
			],
			effect: Effect.ALLOW,
		});
		transcriptionRepository.addToResourcePolicy(workerReadPolicyStatement);
		// allow github actions read/write access to the repo
		const githubReadWritePolicyStatement = new PolicyStatement({
			principals: [new ArnPrincipal(githubActionsIAMRoleArn.valueAsString)],
			actions: [
				'ecr:GetAuthorizationToken',
				'ecr:BatchCheckLayerAvailability',
				'ecr:GetDownloadUrlForLayer',
				'ecr:GetRepositoryPolicy',
				'ecr:DescribeRepositories',
				'ecr:ListImages',
				'ecr:DescribeImages',
				'ecr:BatchGetImage',
				'ecr:InitiateLayerUpload',
				'ecr:UploadLayerPart',
				'ecr:CompleteLayerUpload',
				'ecr:PutImage',
			],
			effect: Effect.ALLOW,
		});
		transcriptionRepository.addToResourcePolicy(githubReadWritePolicyStatement);
		mediaDownloadRepository.addToResourcePolicy(githubReadWritePolicyStatement);

		const repoAccessRole = new Role(this, 'RepoAccessRole', {
			roleName: 'TranscriptionServiceRepoAccessRole',
			assumedBy: new AccountPrincipal(deployToolsAccountNumber.valueAsString),
			inlinePolicies: {
				TranscriptionServiceRepoAccessPolicy: new PolicyDocument({
					statements: [
						new PolicyStatement({
							actions: ['ecr:GetAuthorizationToken'],
							resources: ['*'],
							effect: Effect.ALLOW,
						}),
						new PolicyStatement({
							actions: [
								'ecr:GetDownloadUrlForLayer',
								'ecr:BatchGetImage',
								'ecr:BatchCheckLayerAvailability',
								'ecr:DescribeImages',
								'ecr:ListImages',
								'ecr:GetDownloadUrlForLayer',
							],
							resources: [
								transcriptionRepository.repositoryArn,
								mediaDownloadRepository.repositoryArn,
							],
							effect: Effect.ALLOW,
						}),
					],
				}),
			},
		});

		new CfnOutput(this, 'AccessRoleArn', {
			value: repoAccessRole.roleArn,
		});
	}
}
