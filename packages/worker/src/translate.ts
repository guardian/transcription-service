import {
	InputLanguageCode,
	OutputLanguageCode,
	TranscriptionResult,
} from '@guardian/transcription-service-common';
import { MetricsService } from '@guardian/transcription-service-backend-common/src/metrics';
import { logger } from '@guardian/transcription-service-backend-common';
import { runTranscription, WhisperBaseParams } from './transcribe';

type TranslationConfig = {
	code?: InputLanguageCode;
	shouldTranslate: boolean;
};

export const getTranslationConfig = (
	inputLanguageCode: InputLanguageCode,
	detectedLanguageCode: OutputLanguageCode,
): TranslationConfig => {
	if (inputLanguageCode === 'auto') {
		if (detectedLanguageCode !== 'UNKNOWN' && detectedLanguageCode !== 'en') {
			return {
				code: detectedLanguageCode,
				shouldTranslate: true,
			};
		} else {
			return {
				shouldTranslate: false,
			};
		}
	} else if (inputLanguageCode !== 'en') {
		return {
			code: inputLanguageCode,
			shouldTranslate: true,
		};
	}
	return { shouldTranslate: false };
};

export const transcribeAndTranslate = async (
	whisperBaseParams: WhisperBaseParams,
	whisperX: boolean,
	metrics: MetricsService,
	languageCode: InputLanguageCode,
): Promise<TranscriptionResult> => {
	const run = (translate: boolean, languageCode: InputLanguageCode) =>
		runTranscription(
			whisperBaseParams,
			languageCode,
			translate,
			whisperX,
			metrics,
		);
	try {
		const transcription = await run(false, languageCode);
		const translationConfig = getTranslationConfig(
			languageCode,
			transcription.metadata.detectedLanguageCode,
		);
		if (translationConfig.shouldTranslate && translationConfig.code) {
			const translation = await run(true, translationConfig.code);
			return {
				...transcription,
				transcriptTranslations: translation.transcripts,
			};
		}
		return transcription;
	} catch (error) {
		logger.error(
			`Failed during combined detect language/transcribe/translate process result`,
			error,
		);
		throw error;
	}
};
