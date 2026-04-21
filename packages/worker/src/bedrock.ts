import {
	BedrockRuntimeClient,
	ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { logger } from '@guardian/transcription-service-backend-common';
import { LlmPrompt } from '@guardian/transcription-service-common';

export const sendPromptToBedrock = async (
	prompts: LlmPrompt,
	bedrockModelId: string,
): Promise<string> => {
	const client = new BedrockRuntimeClient({ region: 'eu-west-1' });

	const messages: {
		role: 'user' | 'assistant';
		content: { text: string }[];
	}[] = [{ role: 'user', content: [{ text: prompts.user }] }];

	if (prompts.assistant) {
		messages.push({
			role: 'assistant',
			content: [{ text: prompts.assistant }],
		});
	}

	const command = new ConverseCommand({
		modelId: bedrockModelId,
		messages,
		...(prompts.system ? { system: [{ text: prompts.system }] } : {}),
	});

	logger.info(
		`Sending prompt to Bedrock model ${bedrockModelId} (user prompt length: ${prompts.user.length} chars)`,
	);

	const response = await client.send(command);
	const content = response.output?.message?.content?.[0]?.text;
	if (!content) {
		throw new Error('Bedrock returned an empty response');
	}

	logger.info(
		`Received response from Bedrock (response length: ${content.length} chars)`,
	);

	return content;
};
