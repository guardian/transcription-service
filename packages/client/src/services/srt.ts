export type TranscriptSegment = {
	index: number;
	startTime: number;
	endTime: number;
	text: string;
};

export const parseSRT = (srtText: string): TranscriptSegment[] => {
	const segments: TranscriptSegment[] = [];
	const blocks = srtText.trim().split('\n\n');

	for (const block of blocks) {
		const lines = block.split('\n');
		if (lines.length < 3 || !lines[0] || !lines[1]) continue;

		const index = parseInt(lines[0]);
		// example time line: 00:00:03,000 --> 00:00:06,000
		const timeMatch = lines[1].match(
			/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/,
		);

		if (!timeMatch || timeMatch.length < 9) continue;

		const startTime =
			parseInt(timeMatch[1]!) * 3600 +
			parseInt(timeMatch[2]!) * 60 +
			parseInt(timeMatch[3]!) +
			parseInt(timeMatch[4]!) / 1000;

		const endTime =
			parseInt(timeMatch[5]!) * 3600 +
			parseInt(timeMatch[6]!) * 60 +
			parseInt(timeMatch[7]!) +
			parseInt(timeMatch[8]!) / 1000;

		const text = lines.slice(2).join('\n');

		segments.push({ index, startTime, endTime, text });
	}

	return segments;
};

export const formatTime = (seconds: number): string => {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	}
	return `${minutes}:${secs.toString().padStart(2, '0')}`;
};
