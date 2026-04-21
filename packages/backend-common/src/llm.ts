import { TranscriptionConfig } from './config';
import {
	LlmDynamoItem,
	LLMOutputSuccess,
} from '@guardian/transcription-service-common';
import { FailureMetric, MetricsService } from './metrics';
import { getDynamoClient, writeDynamoItem } from './dynamodb';
import {
	BedrockRuntimeClient,
	ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { logger } from '@guardian/transcription-service-backend-common';
import { LlmPrompt } from '@guardian/transcription-service-common';

const BEDROCK_MODEL_ID = 'qwen.qwen3-next-80b-a3b';

export const sendPromptToBedrock = async (
	prompts: LlmPrompt,
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
		modelId: BEDROCK_MODEL_ID,
		messages,
		...(prompts.system ? { system: [{ text: prompts.system }] } : {}),
	});

	logger.info(
		`Sending prompt to Bedrock model ${BEDROCK_MODEL_ID} (user prompt length: ${prompts.user.length} chars)`,
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

export const saveLllmOutput = async (
	config: TranscriptionConfig,
	llmOutput: LLMOutputSuccess,
	metrics: MetricsService,
) => {
	const dynamoItem: LlmDynamoItem = {
		id: llmOutput.id,
		userEmail: llmOutput.userEmail,
		status: 'LLM_SUCCESS',
		outputKey: llmOutput.outputKey,
		completedAt: new Date().toISOString(),
	};

	try {
		await writeDynamoItem(
			getDynamoClient(config.aws, config.dev?.localstackEndpoint),
			config.app.tableName,
			dynamoItem,
		);

		logger.info('Output handler saved LLM success to DynamoDB', {
			id: llmOutput.id,
			userEmail: llmOutput.userEmail,
		});
	} catch (error) {
		logger.error(
			'Failed to process LLM success message - data may be missing from dynamo',
			error,
		);
		await metrics.putMetric(FailureMetric);
		return false;
	}
	return true;
};
