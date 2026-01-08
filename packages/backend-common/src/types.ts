import { AwsCredentialIdentity, MemoizedProvider } from '@smithy/types';

export enum AWSStatus {
	Success,
	Failure,
}

export interface AwsConfig {
	region: string;
	credentials: MemoizedProvider<AwsCredentialIdentity> | undefined;
}
