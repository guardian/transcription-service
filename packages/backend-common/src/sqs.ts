import {
	SendMessageCommand,
	SQSClient,
	Message,
	ReceiveMessageCommand,
	DeleteMessageCommand,
	ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import {
	DestinationService,
	TranscriptionJob,
	TranscriptionOutput,
	TranscriptionEngine,
	InputLanguageCode,
	ONE_WEEK_IN_SECONDS,
} from '@guardian/transcription-service-common';
import {
	getSignedUploadUrl,
	TranscriptionConfig,
} from '@guardian/transcription-service-backend-common';
import { logger } from '@guardian/transcription-service-backend-common';
import { AwsConfig, AWSStatus } from './types';

interface SendSuccess {
	status: AWSStatus.Success;
	messageId: string;
}

interface ReceiveSuccess {
	status: AWSStatus.Success;
	message?: Message;
}

interface DeleteSuccess {
	status: AWSStatus.Success;
}

interface SQSFailure {
	status: AWSStatus.Failure;
	error?: unknown;
	errorMsg?: string;
}

type SendResult = SendSuccess | SQSFailure;
type ReceiveResult = ReceiveSuccess | SQSFailure;
type DeleteResult = DeleteSuccess | SQSFailure;

export const getSQSClient = (
	awsConfig: AwsConfig,
	localstackEndpoint?: string,
) => {
	const clientConfig = localstackEndpoint
		? { ...awsConfig, endpoint: localstackEndpoint }
		: awsConfig;

	return new SQSClient(clientConfig);
};
export const isSqsFailure = (
	result: SendResult | ReceiveResult,
): result is SQSFailure => result.status === AWSStatus.Failure;

export const generateOutputSignedUrlAndSendMessage = async (
	s3Key: string,
	client: SQSClient,
	config: TranscriptionConfig,
	userEmail: string,
	originalFilename: string,
	inputSignedUrl: string,
	languageCode: InputLanguageCode,
	translationRequested: boolean,
	diarizationRequested: boolean,
): Promise<SendResult> => {
	const combinedOutputKey = `combined/${s3Key}.json`;

	const combinedUrl = await getSignedUploadUrl(
		config.aws,
		config.app.transcriptionOutputBucket,
		userEmail,
		ONE_WEEK_IN_SECONDS,
		false,
		combinedOutputKey,
		undefined,
		'gzip',
	);

	// user whisperX if whisperX enabled and...
	// duration is either unknown or greater than 10 minutes or  diarization has been requested
	// UPDATE: whisper.cpp is being deprecated. Conditional logic here will eventually be removed following a succesful
	// trial of using whisperx for everything
	const engine = config.app.useWhisperx
		? TranscriptionEngine.WHISPER_X
		: TranscriptionEngine.WHISPER_CPP;

	const queue =
		engine === TranscriptionEngine.WHISPER_X
			? config.app.gpuTaskQueueUrl
			: config.app.taskQueueUrl;

	const job: TranscriptionJob = {
		id: s3Key, // id of the source file
		inputSignedUrl,
		sentTimestamp: new Date().toISOString(),
		userEmail,
		transcriptDestinationService: DestinationService.TranscriptionService,
		originalFilename,
		combinedOutputUrl: { key: combinedOutputKey, url: combinedUrl },
		languageCode,
		translate: false,
		diarize: diarizationRequested,
		engine,
	};
	const messageResult = await sendMessage(
		client,
		queue,
		JSON.stringify(job),
		s3Key,
	);
	if (isSqsFailure(messageResult) && translationRequested) {
		logger.info(
			`Failed to send message, error message: ${messageResult.errorMsg}`,
		);
		return messageResult;
	}
	if (!isSqsFailure(messageResult) && translationRequested) {
		const translationId = `${s3Key}-translation`;
		const translationCombinedOutputKey = `combined/${translationId}.json`;
		const translationCombinedUrl = await getSignedUploadUrl(
			config.aws,
			config.app.transcriptionOutputBucket,
			userEmail,
			ONE_WEEK_IN_SECONDS,
			false,
			translationCombinedOutputKey,
			undefined,
			'gzip',
		);
		return await sendMessage(
			client,
			queue,
			JSON.stringify({
				...job,
				id: translationId,
				translate: true,
				combinedOutputUrl: {
					key: translationCombinedOutputKey,
					url: translationCombinedUrl,
				},
			}),
			translationId,
		);
	}
	return messageResult;
};

export const sendMessage = async (
	client: SQSClient,
	queueUrl: string,
	messageBody: string,
	id: string,
): Promise<SendResult> => {
	const fifo = queueUrl.includes('.fifo');
	const fifoProperties = fifo
		? {
				MessageGroupId: id,
			}
		: {};
	try {
		const result = await client.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: messageBody,
				...fifoProperties,
			}),
		);
		logger.info(`Message sent. Message id: ${result.MessageId}`);
		if (result.MessageId) {
			return {
				status: AWSStatus.Success,
				messageId: result.MessageId,
			};
		}
		return {
			status: AWSStatus.Failure,
			errorMsg: 'Missing message ID',
		};
	} catch (e) {
		const msg = `Failed to send message ${messageBody}`;
		logger.error(msg, e);
		return {
			status: AWSStatus.Failure,
			error: e,
			errorMsg: msg,
		};
	}
};

export const publishTranscriptionOutput = async (
	client: SQSClient,
	queueUrl: string,
	output: TranscriptionOutput,
) => {
	await sendMessage(client, queueUrl, JSON.stringify(output), output.id);
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
		logger.info(
			`Successfully updated the VisibilityTimeout of the message to ${timeoutOverride}`,
		);
	} catch (error) {
		const errorMsg = `Failed to update VisibilityTimeout to ${timeoutOverride} for message`;
		logger.error(errorMsg, error);
		throw error;
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
				VisibilityTimeout: 300, // 	5 minutes
				// we need to get message attributes so that we can use ApproximateReceiveCount
				MessageSystemAttributeNames: ['All'],
			}),
		);
		const messages = message.Messages;
		if (messages && messages.length > 0) {
			const message = messages[0];
			return {
				status: AWSStatus.Success,
				message,
			};
		}
		return {
			// this isn't an error scenario - just means there's no available work
			status: AWSStatus.Success,
			message: undefined,
		};
	} catch (error) {
		const errorMsg = 'Failed to receive messages';
		logger.error(errorMsg, error);
		return {
			status: AWSStatus.Failure,
			error,
			errorMsg,
		};
	}
};

export const deleteMessage = async (
	client: SQSClient,
	queueUrl: string,
	receiptHandle: string,
	jobId: string,
): Promise<DeleteResult> => {
	try {
		await client.send(
			new DeleteMessageCommand({
				QueueUrl: queueUrl,
				ReceiptHandle: receiptHandle,
			}),
		);
		return {
			status: AWSStatus.Success,
		};
	} catch (error) {
		const errorMsg = `Failed to delete message ${receiptHandle} for job ${jobId}`;
		logger.error(errorMsg, error);
		return {
			status: AWSStatus.Failure,
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
	id: string,
) => {
	// SQS doesn't seem to offer an atomic way to move message from one queue to
	// another. There is a chance that the write to the dead letter queue
	// succeeds but the delete from the task queue fails
	const sendResult = await sendMessage(
		client,
		deadLetterQueueUrl,
		messageBody,
		id,
	);
	if (sendResult.status == AWSStatus.Failure) {
		// rethrow exception, let another worker retry
		throw Error(
			`Failed to send message to dead letter queue, error: ${sendResult.errorMsg}`,
		);
	}
	// if the delete command throws an exception, it will be caught by
	// deleteMessage and logged. Another worker will reprocess the message in
	// the main task queue and we'll have a duplicate in the dead letter queue.
	await deleteMessage(client, taskQueueUrl, receiptHandle, id);
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
	logger.error(
		`Failed to parse message ${message.MessageId}, contents: ${message.Body}, errors: ${JSON.stringify(job.error.errors, null, 2)}`,
	);
	return undefined;
};
