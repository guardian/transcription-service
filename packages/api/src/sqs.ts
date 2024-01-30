import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

type TranscriptionJob = {
	id: string;
	s3Url: string;
	retryCount: number;
};

enum SendStatus {
	Success,
	Failure,
}

interface SendSuccess {
	status: SendStatus.Success;
	messageId: string;
}

interface SendFailure {
	status: SendStatus.Failure;
	error: any;
	errorMsg: string;
}

type SendResult = SendSuccess | SendFailure;

export const isSuccess = (result: SendResult): result is SendSuccess =>
	result.status === SendStatus.Success;

export const sendMessage = async (
	client: SQSClient,
	queueUrl: string,
): Promise<SendResult> => {
	const job = {
		id: 'my-first-transcription',
		s3Url: 's3://test/test',
		retryCount: 0,
	};

	try {
		const result = await client.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify(job),
			}),
		);
		console.log(`Message sent. Message id: ${result.MessageId}`);
		return {
			status: SendStatus.Success,
			messageId: result.MessageId,
		};
	} catch (e) {
		const msg = `Failed to send job ${JSON.stringify(job, null, 2)}`;
		console.error(msg, e);
		return {
			status: SendStatus.Failure,
			error: e,
			errorMsg: msg,
		};
	}
};
