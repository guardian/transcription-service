import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The build embeds this asset as text; local ts-node runs read the npm package.
export default readFileSync(
	join(
		dirname(require.resolve('@duckduckgo/autoconsent')),
		'autoconsent.playwright.js',
	),
	'utf8',
);
