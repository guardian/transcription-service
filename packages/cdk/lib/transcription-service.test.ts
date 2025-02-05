import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { TranscriptionService } from './transcription-service';

describe('The TranscriptionService stack', () => {
	it('matches the snapshot', () => {
		const app = new App();
		const stack = new TranscriptionService(app, 'TranscriptionService', {
			stack: 'investigations',
			stage: 'TEST',
			env: { region: 'eu-west-1' },
		});
		const template = Template.fromStack(stack);
		expect(template.toJSON()).toMatchSnapshot();
	});
});
