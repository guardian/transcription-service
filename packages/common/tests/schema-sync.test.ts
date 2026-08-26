import * as fs from 'fs';
import * as path from 'path';

import {
	buildWorkerInterfaceJsonSchema,
	workerInterfaceSchemaNames,
} from '../src';
import { JobType } from '../src';

describe('Worker Interface Types Schema Sync', () => {
	const schemaPath = path.resolve(
		__dirname,
		'../schemas/worker-interface-schema.json',
	);
	let savedSchema: Record<string, unknown>;
	let generatedSchema: Record<string, unknown>;

	// named types are emitted once under $defs and referenced via $ref, to avoid
	// repeating large schemas (e.g. the language code enums) throughout the file
	const resolveRef = (
		schema: Record<string, unknown> | undefined,
	): Record<string, unknown> => {
		const ref = schema?.$ref;
		if (typeof ref !== 'string') return schema ?? {};
		const name = ref.replace('#/$defs/', '');
		const defs = savedSchema.$defs as Record<string, Record<string, unknown>>;
		return defs[name] ?? {};
	};

	const getType = (name: string): Record<string, unknown> => {
		const properties = savedSchema.properties as Record<
			string,
			Record<string, unknown>
		>;
		return resolveRef(properties[name]);
	};

	beforeAll(() => {
		// Read the saved schema file
		const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
		savedSchema = JSON.parse(schemaContent);

		// Generate schema from the current types
		generatedSchema = buildWorkerInterfaceJsonSchema();
	});

	it('should have a schema file that exists', () => {
		expect(fs.existsSync(schemaPath)).toBe(true);
	});

	it('should have matching schema structure', () => {
		// Compare the generated schema with the saved schema
		// This test will fail if the types have changed but the schema hasn't been regenerated
		expect(savedSchema).toEqual(generatedSchema);
	});

	it('should contain all expected type schemas', () => {
		const properties = savedSchema.properties as Record<string, unknown>;
		workerInterfaceSchemaNames.forEach((typeName) => {
			expect(properties).toHaveProperty(typeName);
		});
	});

	it('should have correct enum values for JobType', () => {
		expect(getType('JobType').enum).toEqual(JobType.options);
	});

	it('should have correct discriminated union for WorkerJob', () => {
		const workerJob = getType('WorkerJob');
		// Zod 4 uses oneOf for discriminated unions
		expect(workerJob.oneOf).toBeDefined();
		expect(Array.isArray(workerJob.oneOf)).toBe(true);
		expect((workerJob.oneOf as unknown[]).length).toBe(JobType.options.length);

		// Each variant should have the jobType discriminator as a const
		const variants = (workerJob.oneOf as Array<Record<string, unknown>>).map(
			resolveRef,
		);
		const jobTypes = variants.map((variant) => {
			const props = variant.properties as Record<string, unknown>;
			const jobType = props.jobType as Record<string, unknown>;
			return jobType.const;
		});
		expect(jobTypes.sort()).toEqual([...JobType.options].sort());
	});
});
