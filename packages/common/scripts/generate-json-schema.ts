import { z } from 'zod';
import { TranscriptionJob } from '../src';
import fs from 'node:fs';
import path from 'node:path';

const outputDir = process.argv[2];
if (!outputDir) {
	console.error('Usage: generate-json-schema <output-directory>');
	process.exit(1);
}

type Schema = {
	name: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	schema: any;
};

const schemas: Schema[] = [
	{
		name: 'TranscriptionJob',
		schema: z.toJSONSchema(TranscriptionJob),
	},
];

const resolvedDir = path.resolve(outputDir);
fs.mkdirSync(resolvedDir, { recursive: true });

schemas.forEach(({ name, schema }) => {
	fs.writeFileSync(
		path.join(resolvedDir, `${name}.schema.json`),
		JSON.stringify(schema, null, 2),
	);
});
