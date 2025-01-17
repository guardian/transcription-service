import { z } from 'zod';
import { stringToJSONSchema } from './zod-string-to-json';
import { TranscriptionOutput } from '@guardian/transcription-service-common';

const SQSMessageBody = z.object({
	messageId: z.string(),
	body: stringToJSONSchema.pipe(TranscriptionOutput),
});

export const IncomingSQSEvent = z.object({
	Records: z.array(SQSMessageBody),
});

const TranscriptionOutputBaseTest = z.object({
	id: z.string(),
	originalFilename: z.string(),
	userEmail: z.string(),
	isTranslation: z.boolean(),
});

const SQSMessageBodyTest = z.object({
	messageId: z.string(),
	body: stringToJSONSchema.pipe(TranscriptionOutputBaseTest),
});

export const IncomingSQSEventTest = z.object({
	Records: z.array(SQSMessageBodyTest),
});
