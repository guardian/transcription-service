import { GuApiLambda } from "@guardian/cdk";
import { GuStack } from "@guardian/cdk/lib/constructs/core";
import type { GuStackProps } from "@guardian/cdk/lib/constructs/core";
import type { App } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";

export class TranscriptionService extends GuStack {
  constructor(scope: App, id: string, props: GuStackProps) {
    super(scope, id, props);

    const APP_NAME = "transcription-service";
    const apiId = `${APP_NAME}-${props.stage}`

    new GuApiLambda(this, "transcription-service-api", {
      fileName: "api.zip",
      handler: "index.handler",
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
  }
}
