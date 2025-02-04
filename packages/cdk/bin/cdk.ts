import 'source-map-support/register';
import { GuRoot } from '@guardian/cdk/lib/constructs/root';
import { TranscriptionServiceRepository } from '../lib/repository';
import { TranscriptionService } from '../lib/transcription-service';
import { TranscriptionServiceUniversalInfra } from '../lib/universal-infra';

const app = new GuRoot();
new TranscriptionService(app, 'TranscriptionService-CODE', {
	stack: 'investigations',
	stage: 'CODE',
	env: { region: 'eu-west-1' },
});
new TranscriptionService(app, 'TranscriptionService-PROD', {
	stack: 'investigations',
	stage: 'PROD',
	env: { region: 'eu-west-1' },
});

// repository will be shared between CODE and PROD so needs to be a separate stack
new TranscriptionServiceRepository(app, 'TranscriptionServiceRepository', {
	stack: 'investigations',
	stage: 'PROD',
	env: { region: 'eu-west-1' },
});

// This is another stack which is used for both code/prod - but as repository already existed I made a new stack to avoid
// having to delete the whole repository stack (including all containers) in order to give it a less specific name
new TranscriptionServiceUniversalInfra(
	app,
	'TranscriptionServiceUniversalInfra',
	{
		stack: 'investigations',
		stage: 'PROD',
		env: { region: 'eu-west-1' },
	},
);
