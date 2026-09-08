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
		const properties = savedSchema.properties as Record<string, unknown>;
		const jobTypeSchema = properties.JobType as Record<string, unknown>;
		expect(jobTypeSchema.enum).toEqual(JobType.options);
	});

	it('should have correct discriminated union for WorkerJob', () => {
		const properties = savedSchema.properties as Record<string, unknown>;
		const workerJob = properties.WorkerJob as Record<string, unknown>;
		// Zod 4 uses oneOf for discriminated unions
		expect(workerJob.oneOf).toBeDefined();
		expect(Array.isArray(workerJob.oneOf)).toBe(true);
		expect((workerJob.oneOf as unknown[]).length).toBe(JobType.options.length);

		// Each variant should have the jobType discriminator as a const
		const variants = workerJob.oneOf as Array<Record<string, unknown>>;
		const jobTypes = variants.map((variant) => {
			const props = variant.properties as Record<string, unknown>;
			const jobType = props.jobType as Record<string, unknown>;
			return jobType.const;
		});
		expect(jobTypes.sort()).toEqual([...JobType.options].sort());
	});
});
