import type { GuStackProps } from '@guardian/cdk/lib/constructs/core';
import { GuStack } from '@guardian/cdk/lib/constructs/core';
import { GuS3Bucket } from '@guardian/cdk/lib/constructs/s3';
import type { App } from 'aws-cdk-lib';
import { CfnOutput } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export class TranscriptionServiceUniversalInfra extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		const layerBucket = new GuS3Bucket(this, 'LayerBucket', {
			bucketName: 'transcription-service-lambda-layers',
			app: 'transcription-service-universal-infra',
		});

		new StringParameter(this, 'ExportFunctionName', {
			parameterName: `/investigations/transcription-service/lambdaLayerBucketArn`,
			stringValue: layerBucket.bucketArn,
		});

		new CfnOutput(this, 'LayerBucket', {
			value: layerBucket.bucketArn,
		});
	}
}
