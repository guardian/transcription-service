import {
	SendMessageCommand,
	SQSClient,
	Message,
	ReceiveMessageCommand,
	DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { TranscriptionJob } from '@guardian/transcription-service-common';

enum SQSStatus {
	Success,
	Failure,
}

interface SendSuccess {
	status: SQSStatus.Success;
	messageId: string;
}

interface ReceiveSuccess {
	status: SQSStatus.Success;
	message?: Message;
}

interface SQSFailure {
	status: SQSStatus.Failure;
	error?: any;
	errorMsg?: string;
}

type SendResult = SendSuccess | SQSFailure;
type ReceiveResult = ReceiveSuccess | SQSFailure;

export const getClient = (localstackEndpoint?: string) => {
	const clientBaseConfig = {
		region: 'eu-west-1',
	};
	const clientConfig = localstackEndpoint
		? { ...clientBaseConfig, endpoint: localstackEndpoint }
		: clientBaseConfig;

	return new SQSClient(clientConfig);
};
export const isFailure = (
	result: SendResult | ReceiveResult,
): result is SQSFailure => result.status === SQSStatus.Failure;

export const sendMessage = async (
	client: SQSClient,
	queueUrl: string,
): Promise<SendResult> => {
	const job: TranscriptionJob = {
		id: 'my-first-transcription',
		s3Url: 's3://test/test',
		retryCount: 0,
		sentTimestamp: new Date().toISOString(),
	};

	try {
		const result = await client.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify(job),
			}),
		);
		console.log(`Message sent. Message id: ${result.MessageId}`);
		if (result.MessageId) {
			return {
				status: SQSStatus.Success,
				messageId: result.MessageId,
			};
		}
		return {
			status: SQSStatus.Failure,
			errorMsg: 'Missing message ID',
		};
	} catch (e) {
		const msg = `Failed to send job ${JSON.stringify(job, null, 2)}`;
		console.error(msg, e);
		return {
			status: SQSStatus.Failure,
			error: e,
			errorMsg: msg,
		};
	}
};

export const getNextMessage = async (
	client: SQSClient,
	queueUrl: string,
): Promise<ReceiveResult> => {
	try {
		const message = await client.send(
			new ReceiveMessageCommand({
				QueueUrl: queueUrl,
				// workers process one transcript at a time
				MaxNumberOfMessages: 1,
				// Not sure we need to set this here - could just rely on the queue default
				VisibilityTimeout: 300,
			}),
		);
		const messages = message.Messages;
		if (messages && messages.length > 0) {
			const message = messages[0];
			return {
				status: SQSStatus.Success,
				message,
			};
		}
		return {
			// this isn't an error scenario - just means there's no available work
			status: SQSStatus.Success,
			message: undefined,
		};
	} catch (error) {
		const errorMsg = 'Failed to receive messages';
		console.error(errorMsg, error);
		return {
			status: SQSStatus.Failure,
			error,
			errorMsg,
		};
	}
};

export const deleteMessage = async (
	client: SQSClient,
	queueUrl: string,
	reciptHandle: string,
) => {
	try {
		await client.send(
			new DeleteMessageCommand({
				QueueUrl: queueUrl,
				ReceiptHandle: reciptHandle,
			}),
		);
	} catch (error) {
		console.error(`Failed to delete message ${reciptHandle}`, error);
	}
};

export const parseTranscriptJobMessage = (
	message: Message,
): TranscriptionJob | undefined => {
	const job = TranscriptionJob.safeParse(JSON.parse(message.Body));
	if (job.success) {
		return job.data;
	}
	console.error(
		`Failed to parseee message ${message.MessageId}, contents: ${message.Body}`,
	);
	return undefined;
};