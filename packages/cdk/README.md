# Infrastructure

This directory defines the components to be deployed to AWS.

See [`package.json`](./package.json) for a list of available scripts.

## Stacks

### Transcription-Service

This is the main stack with the vast majority of the infrastructure.

### Repository

This stack could probably be merged with universal-infra (it isn't for historical reasons). It contains all the relevant
infra and IAM permissions to support publishing docker images from github actions to ECR.

### Universal-Infra

This stack was created to contain resources shared across all stages.
