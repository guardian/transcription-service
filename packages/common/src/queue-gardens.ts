// IMPORTANT: the order is crucial here, when it's iterated over in the worker for example
export const priorityLevels = [
	// trumps standard, but will let the current standard level job complete - might result in higher cost services being used to clear
	'high',
	// trumps low and will cancel low level jobs
	'standard',
	// only expect things on here to be processed when our services are idle and will be killed if something comes in on standard/high
	'low',
] as const;
export type PriorityLevel = (typeof priorityLevels)[number];

// TODO for each consider linking to the type definition for the payload
export const activityTypes = [
	// 'media-download', // standalone queue, doesn't need the priority/sensitivity
	'transcription',
	'translation',
	'visual-ocr',
	// 'snapshotting', // standalone queue, doesn't need the priority/sensitivity
	'ai-prompt',
] as const;
export type ActivityType = (typeof activityTypes)[number];

// used to determine where the activity takes place
export const sensitivityLevels = [
	'public-domain', // for documents/files already in the public domain
	'regular-sensitivity', // non-public documents, which we should only process in AWS/on-prem
	// "super-sensitive" // super sensitive documents are only process by the offline giant in the bunker
] as const;
export type SensitivityLevel = (typeof sensitivityLevels)[number];

type QueueType = 'queue' | 'DLQ';

export const buildQueueUrl = (
	queuesBaseUrl: string,
	queueType: QueueType,
	priorityLevel: PriorityLevel,
	sensitivityLevel: SensitivityLevel,
	activityType: ActivityType,
	stage: string,
) =>
	`${queuesBaseUrl}${buildVerifiedQueueName(priorityLevel, sensitivityLevel, activityType)(queueType, stage)}`;

export const buildVerifiedQueueName =
	(
		priorityLevel: PriorityLevel,
		sensitivityLevel: SensitivityLevel,
		activityType: ActivityType,
	) =>
	(
		queueType: QueueType,
		maybeStage?: string, // optional because we also want to build logical IDs for the queues, which don't have the stage suffix
	) => {
		const suffix = maybeStage ? `_${maybeStage}` : '';
		const potentialName = `investigations-${queueType}_${priorityLevel.toUpperCase()}-priority_${sensitivityLevel}_${activityType}${suffix}`;
		if (potentialName.length > 80) {
			throw Error(
				`Queue name "${potentialName}" exceeds the maximum length of 80 characters (by ${potentialName.length - 80})`,
			);
		}
		return potentialName;
	};
