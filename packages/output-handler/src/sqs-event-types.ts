import { z } from 'zod';
import { stringToJSONSchema } from './zod-string-to-json';
import { TranscriptionOutput } from '@guardian/transcription-service-common';

const SQSMessageBody = z.object({
	MessageId: z.string(),
	Timestamp: z.string(),
	Message: stringToJSONSchema.pipe(TranscriptionOutput),
});

export const IncomingSQSEvent = z.object({
	Records: z.array(
		z.object({
			body: stringToJSONSchema.pipe(SQSMessageBody),
		}),
	),
});
