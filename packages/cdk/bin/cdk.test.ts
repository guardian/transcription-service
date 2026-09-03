import { Template } from 'aws-cdk-lib/assertions';
import { guStacks } from './cdk';

describe("Giant's", () => {
	it('stacks should match the snapshots', () => {
		guStacks.forEach((stack) =>
			expect(Template.fromStack(stack)).toMatchSnapshot(),
		);
	});

	it('riff-raff.yaml should match the snapshot', () => {
		// TODO consider snapshotting
	});
});
