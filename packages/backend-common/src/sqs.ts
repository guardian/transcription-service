import {
	SendMessageCommand,
	SQSClient,
	Message,
	ReceiveMessageCommand,
	DeleteMessageCommand,
	ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import {
	OutputBucketUrls,
	DestinationService,
	TranscriptionJob,
} from '@guardian/transcription-service-common';
import { getSignedUploadUrl } from '@guardian/transcription-service-backend-common';

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

interface DeleteSuccess {
	status: SQSStatus.Success;
}

interface SQSFailure {
	status: SQSStatus.Failure;
	error?: unknown;
	errorMsg?: string;
}

type SendResult = SendSuccess | SQSFailure;
type ReceiveResult = ReceiveSuccess | SQSFailure;
type DeleteResult = DeleteSuccess | SQSFailure;

export const getSQSClient = (region: string, localstackEndpoint?: string) => {
	const clientBaseConfig = {
		region,
	};

	const clientConfig = localstackEndpoint
		? { ...clientBaseConfig, endpoint: localstackEndpoint }
		: clientBaseConfig;

	return new SQSClient(clientConfig);
};
export const isFailure = (
	result: SendResult | ReceiveResult,
): result is SQSFailure => result.status === SQSStatus.Failure;

export const generateOutputSignedUrlAndSendMessage = async (
	id: string,
	client: SQSClient,
	queueUrl: string,
	outputBucket: string,
	region: string,
	userEmail: string,
	originalFilename: string,
	inputSignedUrl: string,
): Promise<SendResult> => {
	const signedUrls = await generateOutputSignedUrls(
		id,
		region,
		outputBucket,
		userEmail,
		originalFilename,
		7,
	);

	const job: TranscriptionJob = {
		id, // id of the source file
		inputSignedUrl,
		retryCount: 0,
		sentTimestamp: new Date().toISOString(),
		userEmail,
		transcriptDestinationService: DestinationService.TranscriptionService,
		originalFilename,
		outputBucketUrls: signedUrls,
	};
	return await sendMessage(client, queueUrl, JSON.stringify(job));
};

const sendMessage = async (
	client: SQSClient,
	queueUrl: string,
	messageBody: string,
): Promise<SendResult> => {
	try {
		const result = await client.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: messageBody,
				MessageGroupId: 'api-transcribe-request',
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
		const msg = `Failed to send job ${messageBody}`;
		console.error(msg, e);
		return {
			status: SQSStatus.Failure,
			error: e,
			errorMsg: msg,
		};
	}
};

export const changeMessageVisibility = async (
	client: SQSClient,
	queueUrl: string,
	receiptHandle: string,
	timeoutOverride: number,
) => {
	const command = new ChangeMessageVisibilityCommand({
		QueueUrl: queueUrl,
		VisibilityTimeout: timeoutOverride,
		ReceiptHandle: receiptHandle,
	});

	try {
		await client.send(command);
		console.log(
			`Successfully updated the VisibilityTimeout of the message to ${timeoutOverride}`,
		);
	} catch (error) {
		const errorMsg = `Failed to update VisibilityTimeout to ${timeoutOverride} for message`;
		console.error(errorMsg, error);
		throw error;
	}
};

export const getNextMessage = async (
	client: SQSClient,
	queueUrl: string,
	timeoutOverride?: number,
): Promise<ReceiveResult> => {
	try {
		const message = await client.send(
			new ReceiveMessageCommand({
				QueueUrl: queueUrl,
				// workers process one transcript at a time
				MaxNumberOfMessages: 1,
				// Not sure we need to set this here - could just rely on the queue default
				VisibilityTimeout: timeoutOverride ?? 300,
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
	receiptHandle: string,
): Promise<DeleteResult> => {
	try {
		await client.send(
			new DeleteMessageCommand({
				QueueUrl: queueUrl,
				ReceiptHandle: receiptHandle,
			}),
		);
		return {
			status: SQSStatus.Success,
		};
	} catch (error) {
		const errorMsg = `Failed to delete message ${receiptHandle}`;
		console.error(errorMsg, error);
		return {
			status: SQSStatus.Failure,
			error,
			errorMsg,
		};
	}
};

export const moveMessageToDeadLetterQueue = async (
	client: SQSClient,
	taskQueueUrl: string,
	deadLetterQueueUrl: string,
	messageBody: string,
	receiptHandle: string,
) => {
	// SQS doesn't seem to offer an atomic way to move message from one queue to
	// another. There is a chance that the write to the dead letter queue
	// succeeds but the delete from the task queue fails
	const sendResult = await sendMessage(client, deadLetterQueueUrl, messageBody);
	if (sendResult.status == SQSStatus.Failure) {
		const errorMessage = 'Failed to send message to dead letter queue.';
		console.error(errorMessage, sendResult.error, sendResult.errorMsg);
		throw Error(errorMessage);
	}
	// if the delete command throws an exception, it will be caught by
	// deleteMessage and logged
	await deleteMessage(client, taskQueueUrl, receiptHandle);
};

export const parseTranscriptJobMessage = (
	message: Message,
): TranscriptionJob | undefined => {
	if (!message.Body) {
		return undefined;
	}
	const job = TranscriptionJob.safeParse(JSON.parse(message.Body));
	if (job.success) {
		return job.data;
	}
	console.error(
		`Failed to parse message ${message.MessageId}, contents: ${message.Body}`,
	);
	return undefined;
};

const generateOutputSignedUrls = async (
	id: string,
	region: string,
	outputBucket: string,
	userEmail: string,
	originalFilename: string,
	expiresInDays: number,
): Promise<OutputBucketUrls> => {
	const expiresIn = expiresInDays * 24 * 60;
	const srtKey = `srt/${id}.srt`;
	const jsonKey = `json/${id}.json`;
	const textKey = `text/${id}.txt`;
	const srtSignedS3Url = await getSignedUploadUrl(
		region,
		outputBucket,
		userEmail,
		expiresIn,
		false,
		srtKey,
	);
	const textSignedS3Url = await getSignedUploadUrl(
		region,
		outputBucket,
		userEmail,
		expiresIn,
		false,
		jsonKey,
	);
	const jsonSignedS3Url = await getSignedUploadUrl(
		region,
		outputBucket,
		userEmail,
		expiresIn,
		false,
		textKey,
	);

	return {
		srt: { url: srtSignedS3Url, key: srtKey },
		text: { url: textSignedS3Url, key: textKey },
		json: { url: jsonSignedS3Url, key: jsonKey },
	};
};
