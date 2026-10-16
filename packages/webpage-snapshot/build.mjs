import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const script = readFileSync(
	join(
		dirname(require.resolve('@duckduckgo/autoconsent')),
		'autoconsent.playwright.js',
	),
	'utf8',
);

await build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	platform: 'node',
	target: 'node20',
	external: ['puppeteer', '@sparticuz/chromium'],
	outfile: 'dist/index.js',
	plugins: [
		{
			name: 'embed-autoconsent',
			setup(build) {
				build.onLoad({ filter: /autoconsent-script\.ts$/ }, () => ({
					contents: `export default ${JSON.stringify(script)};`,
					loader: 'js',
				}));
			},
		},
	],
});
