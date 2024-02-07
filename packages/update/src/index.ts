import { Handler } from 'aws-lambda';
import { getConfig } from '@guardian/transcription-service-common';
import { sendEmail, getSESClient } from './ses';

export const handler: Handler = async (event, context) => {
	console.log('EVENT: \n' + JSON.stringify(event, null, 2));

	const config = await getConfig();
	const sesClient = getSESClient(config.aws.region);
	await sendEmail(
		sesClient,
		config.app.emailNotificationFromAddress,
		'philip.mcmahon@theguardian.com',
		'test.mp3',
	);
	return context.logStreamName;
};
