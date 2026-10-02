# Infrastructure

This directory defines the components to be deployed to AWS.

See [`package.json`](./package.json) for a list of available scripts.

## Lint dependencies

The CDK lint toolchain uses TypeScript 5.9, while the repository root uses TypeScript 6.
Keep `ts-api-utils` pinned locally to 2.4.0 so npm installs it alongside the CDK
compiler instead of sharing the root copy. Sharing it mixes TypeScript versions
with different internal type flags, causing false `no-unnecessary-condition` and
`only-throw-error` reports. Revisit this pin when upgrading the CDK lint toolchain
to TypeScript 6.

## Stacks

NOTE! GuCDK generates riff-raff.yaml files for these projects but we don't use the generated files because they don't
quite work for us - instead we use the manually created files at cdk/ (rather than the auto generated ones at cdk/cdk.out/)

However, when added a new microservice it can be helpful to copy paste stuff from the generated files as it's usually
mostly if not completely correct.

### Transcription-Service

This is the main stack with the vast majority of the infrastructure.

### Repository

This stack could probably be merged with universal-infra (it isn't for historical reasons). It contains all the relevant
infra and IAM permissions to support publishing docker images from github actions to ECR.

### Universal-Infra

This stack was created to contain resources shared across all stages.
