import { getTranslationConfig } from './transcribe';

describe('getTranslationConfig', () => {
	describe('when inputLanguageCode is "auto"', () => {
		it('should translate when detected language is not English and not UNKNOWN', () => {
			const result = getTranslationConfig('auto', 'es');
			expect(result).toEqual({
				code: 'es',
				shouldTranslate: true,
			});
		});

		it('should not translate when detected language is English', () => {
			const result = getTranslationConfig('auto', 'en');
			expect(result).toEqual({
				shouldTranslate: false,
			});
		});

		it('should not translate when detected language is UNKNOWN', () => {
			const result = getTranslationConfig('auto', 'UNKNOWN');
			expect(result).toEqual({
				shouldTranslate: false,
			});
		});
	});

	describe('when inputLanguageCode is a specific non-English language', () => {
		it('should translate Spanish to English', () => {
			const result = getTranslationConfig('es', 'es');
			expect(result).toEqual({
				code: 'es',
				shouldTranslate: true,
			});
		});

		it('should prioritise input code rather than detected language', () => {
			const result = getTranslationConfig('es', 'fr');
			expect(result).toEqual({
				code: 'es',
				shouldTranslate: true,
			});
		});

		describe('when inputLanguageCode is English', () => {
			it('should not translate when input is English even if detected language differs', () => {
				const result = getTranslationConfig('en', 'es');
				expect(result).toEqual({
					shouldTranslate: false,
				});
			});

			it('should not translate when input is English and detected is UNKNOWN', () => {
				const result = getTranslationConfig('en', 'UNKNOWN');
				expect(result).toEqual({
					shouldTranslate: false,
				});
			});
		});

		describe('edge cases', () => {
			it('should return correct structure with code when translation is needed', () => {
				const result = getTranslationConfig('es', 'es');
				expect(result).toHaveProperty('code');
				expect(result).toHaveProperty('shouldTranslate');
				expect(result.code).toBeDefined();
			});

			it('should return correct structure without code when translation is not needed', () => {
				const result = getTranslationConfig('en', 'en');
				expect(result).toHaveProperty('shouldTranslate');
				expect(result.shouldTranslate).toBe(false);
				expect(result.code).toBeUndefined();
			});
		});
	});
});
