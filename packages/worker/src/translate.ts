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
	metrics: MetricsService,
	languageCode: InputLanguageCode,
	maybeAbortSignal: AbortSignal | undefined,
): Promise<TranscriptionResult> => {
	try {
		const transcription = await runTranscription(
			whisperBaseParams,
			languageCode,
			false,
			metrics,
			maybeAbortSignal,
		);
		const translationConfig = getTranslationConfig(
			languageCode,
			transcription.metadata.detectedLanguageCode,
		);
		if (translationConfig.shouldTranslate && translationConfig.code) {
			const translation = await runTranscription(
				whisperBaseParams,
				translationConfig.code,
				true,
				metrics,
				maybeAbortSignal,
			);
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
