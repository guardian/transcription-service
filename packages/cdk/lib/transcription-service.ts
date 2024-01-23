import { GuApiLambda } from "@guardian/cdk";
import { GuStack } from "@guardian/cdk/lib/constructs/core";
import type { GuStackProps } from "@guardian/cdk/lib/constructs/core";
import { GuardianAwsAccounts } from "@guardian/private-infrastructure-config";
import type { App } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";

export class TranscriptionService extends GuStack {
  constructor(scope: App, id: string, props: GuStackProps) {
    super(scope, id, props);

    const APP_NAME = "transcription-service";
    const apiId = `${APP_NAME}-${props.stage}`;
    if (!props.env?.region) throw new Error("region not provided in props");
    
    const ssmPrefix = `arn:aws:ssm:${props.env.region}:${GuardianAwsAccounts.Investigations}:parameter`;

    const apiLambda = new GuApiLambda(this, "transcription-service-api", {
      fileName: "api.zip",
      handler: "index.api",
      runtime: Runtime.NODEJS_20_X,
      monitoringConfiguration: {
        noMonitoring: true,
      },
      app: APP_NAME,
      api: {
        id: apiId,
        description: "API for transcription service frontend",
      },
    });

    apiLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ssm:GetParameter", "ssm:GetParametersByPath"],
      resources: [`${ssmPrefix}/${this.stage}/${this.stack}/${APP_NAME}/*`],
    }));
  }
}
