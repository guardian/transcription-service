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

// used to determine where the activity takes place
export const sensitivityLevels = [
	'public-domain', // for documents/files already in the public domain
	'regular-sensitivity', // non-public documents, which we should only process in AWS/on-prem
	// "super-sensitive" // super sensitive documents are only process by the offline giant in the bunker
] as const;
