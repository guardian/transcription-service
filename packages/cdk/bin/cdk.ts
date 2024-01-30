import 'source-map-support/register';
import { GuRoot } from '@guardian/cdk/lib/constructs/root';
import { TranscriptionServiceRepository } from '../lib/repository';
import { TranscriptionService } from '../lib/transcription-service';

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
