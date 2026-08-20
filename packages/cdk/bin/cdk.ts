import 'source-map-support/register';
import { GuRoot } from '@guardian/cdk/lib/constructs/root';
import { QueueGardens } from '../lib/queue-gardens';
import { TranscriptionServiceRepository } from '../lib/repository';
import { TranscriptionService } from '../lib/transcription-service';
import { TranscriptionServiceUniversalInfra } from '../lib/universal-infra';

const stack = 'investigations';
const env = { region: 'eu-west-1' };

const app = new GuRoot();

export const guStacks = [
	new TranscriptionService(app, 'TranscriptionService-CODE', {
		stack,
		stage: 'CODE',
		env,
	}),
	new TranscriptionService(app, 'TranscriptionService-PROD', {
		stack,
		stage: 'PROD',
		env,
	}),

	// repository will be shared between CODE and PROD so needs to be a separate stack
	new TranscriptionServiceRepository(app, 'TranscriptionServiceRepository', {
		stack,
		stage: 'PROD', // TODO probably ought to be INFRA?
		env,
	}),

	// This is another stack which is used for both code/prod - but as repository already existed I made a new stack to avoid
	// having to delete the whole repository stack (including all containers) in order to give it a less specific name
	new TranscriptionServiceUniversalInfra(
		app,
		'TranscriptionServiceUniversalInfra',
		{
			stack,
			stage: 'PROD', // TODO probably ought to be INFRA?
			env,
		},
	),

	new QueueGardens(app, 'QueueGardens-CODE', {
		stack,
		stage: 'CODE',
		env,
	}),
	new QueueGardens(app, 'QueueGardens-PROD', {
		stack,
		stage: 'PROD',
		env,
	}),
];
