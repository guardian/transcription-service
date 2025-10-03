import { getSignedUploadUrl } from '@guardian/transcription-service-backend-common';

export const getTestMessage = async () => {
	const signedUrl = await getSignedUploadUrl(
		'eu-west-1',
		'transcription-service-output-dev',
		'hellier@numanindustries.com',
		3600,
		false,
		'testfile.json',
	);
	return {
		Records: [
			{
				messageId: 'id123',
				ReceiptHandle: 'abc123',
				MD5OfBody: 'md5md5',
				body: `{"id":"483be6b2-f0f8-4ba2-8416-35e0c0a0f4a3","url":"https://en.wikipedia.org/wiki/Toast_sandwich","client":"EXTERNAL","outputQueueUrl":"","s3OutputSignedUrl":"${signedUrl}"}`,
			},
		],
	};
};
