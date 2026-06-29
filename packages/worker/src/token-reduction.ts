// URLs and email addresses are token-expensive, here we swap them out to save tokens. Using
// CJK brackets for the placeholder in the hope that they are unlikely to naturally occur in the document

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;
const EMAIL_REGEX = /[^\s<>"'()[\]]+@[^\s<>"'()[\]]+\.[^\s<>"'()[\]]+/g;

export const maskUrlsAndEmails = (
	text: string,
): { maskedText: string; maskLookup: Record<string, string> } => {
	const maskLookup: Record<string, string> = {};
	const replaceMatchWithMask = (match: string) => {
		const mask = `〔#${Object.keys(maskLookup).length}〕`;
		maskLookup[mask] = match;
		return mask;
	};
	// Mask URLs first so email addresses inside URLs aren't double-masked.
	const maskedText = text
		.replace(URL_REGEX, replaceMatchWithMask)
		.replace(EMAIL_REGEX, replaceMatchWithMask);
	return { maskedText, maskLookup };
};

export const restoreMaskedItems = (
	text: string,
	maskLookup: Record<string, string>,
): string => text.replace(/〔#(\d+)〕/g, (match) => maskLookup[match] ?? match);
