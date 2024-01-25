import 'source-map-support/register';
import { GuRoot } from '@guardian/cdk/lib/constructs/root';
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
