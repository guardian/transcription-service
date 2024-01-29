import type {GuStackProps} from "@guardian/cdk/lib/constructs/core";
import {GuStack, GuStringParameter} from "@guardian/cdk/lib/constructs/core";
import type {App} from "aws-cdk-lib";
import {RemovalPolicy} from "aws-cdk-lib";
import {Repository, TagMutability} from "aws-cdk-lib/aws-ecr";
import {ArnPrincipal, Effect, PolicyStatement} from "aws-cdk-lib/aws-iam";

export class TranscriptionServiceRepository extends GuStack {
    constructor(scope: App, id: string, props: GuStackProps) {
        super(scope, id, props);
        const githubActionsIAMRoleArn = new GuStringParameter(this, "GithubActionsIAMRoleArn", {
            description: "IAM role for role used by github actions workflows"
        })
        const repository = new Repository(this, "TranscriptionServiceRepository", {
            repositoryName: `transcription-service`,
            lifecycleRules: [{
                maxImageCount: 5
            }],
            imageTagMutability: TagMutability.IMMUTABLE,
            removalPolicy: RemovalPolicy.DESTROY,
            imageScanOnPush: true,
        })
        repository.addToResourcePolicy(new PolicyStatement({
            principals: [new ArnPrincipal(githubActionsIAMRoleArn.valueAsString)],
            actions: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:GetRepositoryPolicy",
                "ecr:DescribeRepositories",
                "ecr:ListImages",
                "ecr:DescribeImages",
                "ecr:BatchGetImage",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload",
                "ecr:PutImage"
            ],
            effect: Effect.ALLOW
        }))
    }
}