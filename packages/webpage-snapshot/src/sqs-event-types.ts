import { z } from 'zod';
import { stringToJSONSchema } from './zod-string-to-json';
import { ExternalWebpageSnapshotJob } from '@guardian/transcription-service-common';

const SQSMessageBody = z.object({
	messageId: z.string(),
	body: stringToJSONSchema.pipe(ExternalWebpageSnapshotJob),
});

export const IncomingSQSEvent = z.object({
	Records: z.array(SQSMessageBody),
});
