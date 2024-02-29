export const testMessage = {
	Records: [
		{
			messageId: 'e60db2e5-b671-4832-abd4-c3fd40fe1c92',
			status: 'SUCCESS',
			receiptHandle: 'handle123',
			body:
				'{\n' +
				'  "Type" : "Notification",\n' +
				'  "MessageId" : "20c227f2-5767-5ac8-a037-79abd623a58a",\n' +
				'  "TopicArn" : "arn:aws:sns:eu-west-1:123123123:transcription-service-destination-topic-CODE",\n' +
				'  "Message" : "{\\"id\\":\\"e3df82e0-8e8a-4c36-9388-741ba97e502c\\",\\"languageCode\\":\\"en\\",\\"userEmail\\":\\"someone@guardian.co.uk\\",\\"originalFilename\\":\\"estoyaquishort.wav\\",\\"outputBucketKeys\\":{\\"srt\\":\\"srt/e3df82e0-8e8a-4c36-9388-741ba97e502c.srt\\",\\"json\\":\\"json/e3df82e0-8e8a-4c36-9388-741ba97e502c.json\\",\\"text\\":\\"text/e3df82e0-8e8a-4c36-9388-741ba97e502c.txt\\"}}",\n' +
				'  "Timestamp" : "2024-02-28T18:44:20.741Z",\n' +
				'  "SignatureVersion" : "1"' +
				'}',
			eventSourceARN: 'arn:aws:sqs:eu-west-1:123456789:queueMcQueueFace.fifo',
		},
	],
};
