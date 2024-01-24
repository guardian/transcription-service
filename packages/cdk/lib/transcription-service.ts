import { GuApiLambda } from '@guardian/cdk';
import { GuStack } from '@guardian/cdk/lib/constructs/core';
import type { GuStackProps } from '@guardian/cdk/lib/constructs/core';
import { GuStringParameter } from '@guardian/cdk/lib/constructs/core/parameters';
import { GuCname } from '@guardian/cdk/lib/constructs/dns';
import { GuardianAwsAccounts } from '@guardian/private-infrastructure-config';
import { type App, Duration } from 'aws-cdk-lib';
import { EndpointType } from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

export class TranscriptionService extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		const APP_NAME = 'transcription-service';
		const apiId = `${APP_NAME}-${props.stage}`;
		if (!props.env?.region) throw new Error('region not provided in props');

		const ssmPrefix = `arn:aws:ssm:${props.env.region}:${GuardianAwsAccounts.Investigations}:parameter`;
		const ssmPath = `${this.stage}/${this.stack}/${APP_NAME}`;
    const domainName = this.stage === 'PROD' ? 'transcribe.gutools.co.uk' : 'transcribe.code.dev-gutools.co.uk';

		const certificateId = new GuStringParameter(this, 'certificateId', {
			fromSSM: true,
			default: `${ssmPath}/certificateId`,
		});
		const certificateArn = `arn:aws:acm:${props.env.region}:${GuardianAwsAccounts.Investigations}:certificate/${certificateId.valueAsString}`;
		const certificate = Certificate.fromCertificateArn(
			this,
			`${APP_NAME}-certificate`,
			certificateArn,
		);

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
			ttl: Duration.minutes(1),
			resourceRecord: apiDomain.domainNameAliasDomainName
		});
	}
}
