import guardian from '@guardian/eslint-config';

export default [
	...guardian.configs.recommended,
	...guardian.configs.jest,
	{
		ignores: ['cdk.out/**', '**/*.js', '**/*.d.ts'],
	},
	{
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: { tsconfigRootDir: import.meta.dirname },
		},
		rules: {
			'@typescript-eslint/no-inferrable-types': 'off',
			'import/no-namespace': 'error',
		},
	},
];
