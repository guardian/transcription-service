import { z } from 'zod';
import { stringToJSONSchema } from './zod-string-to-json';
import { ExternalUrlJob } from '@guardian/transcription-service-common';

const SQSMessageBody = z.object({
	messageId: z.string(),
	body: stringToJSONSchema.pipe(ExternalUrlJob),
});

export const IncomingSQSEvent = z.object({
	Records: z.array(SQSMessageBody),
});
