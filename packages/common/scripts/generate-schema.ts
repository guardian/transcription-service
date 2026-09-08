import * as fs from 'fs';
import * as path from 'path';

import { buildWorkerInterfaceJsonSchema } from '../src/worker-interface-schema';

const outputPath = path.resolve(
	__dirname,
	'../schemas/worker-interface-schema.json',
);
const outputDir = path.dirname(outputPath);

if (!fs.existsSync(outputDir)) {
	fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(
	outputPath,
	JSON.stringify(buildWorkerInterfaceJsonSchema(), null, 2),
);
console.log(`Schema written to ${outputPath}`);
