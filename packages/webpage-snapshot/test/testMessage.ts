import { getSignedUploadUrl } from '@guardian/transcription-service-backend-common';

export const getTestMessage = async () => {
	const signedUrl = await getSignedUploadUrl(
		'eu-west-1',
		'pfi-playground-remote-ingest-data-rex',
		'hellier@numanindustries.com',
		3600,
		false,
		'testfile.json',
	);
	console.log(signedUrl);
	return {
		Records: [
			{
				messageId: 'id123',
				ReceiptHandle: 'abc123',
				MD5OfBody: 'md5md5',
				body: `{"id":"483be6b2-f0f8-4ba2-8416-35e0c0a0f4a3","url":"https://www.theguardian.com/","client":"EXTERNAL","outputQueueUrl":"","mediaDownloadId":"media-download-id-123","webpageSnapshotId":"webpage-snapshot-id-456","mediaDownloadOutputSignedUrl":"","webpageSnapshotOutputSignedUrl":"${signedUrl}"}`,
			},
		],
	};
};

export const sqsMessageToTestMessage = (sqsMessage: string) => {
	return {
		Records: [
			{
				messageId: 'id123',
				ReceiptHandle: 'abc123',
				MD5OfBody: 'md5md5',
				body: sqsMessage,
			},
		],
	};
};
