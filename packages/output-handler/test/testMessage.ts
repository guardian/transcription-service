export const testMessage = {
	Records: [
		{
			messageId: 'abc123',
			body: '{\n  "Type" : "Notification",\n  "MessageId" : "message-id",\n  "TopicArn" : "mytopicarn",\n  "Message" : "{\\"id\\":\\"my-first-transcription\\",\\"outputBucketKeys\\":{\\"srt\\":\\"srt/my-first-transcription.srt\\", \\"json\\":\\"json/my-first-transcription.json\\", \\"text\\":\\"text/my-first-transcription.txt\\"},\\"languageCode\\":\\"en\\",\\"userEmail\\":\\"test@test.com\\",\\"originalFilename\\":\\"test.mp3\\"}",\n  "Timestamp" : "2024-02-08T11:10:11.014Z"\n}',
		},
	],
};
