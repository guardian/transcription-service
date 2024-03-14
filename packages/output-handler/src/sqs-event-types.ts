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
