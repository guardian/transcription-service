/**
 * Code copied from https://github.com/JacobWeisenburger/zod_utilz/blob/main/src/json.ts - discovered via this discussion
 * https://github.com/colinhacks/zod/discussions/2215
 *
 * All credit to @JacobWeisenburger
 */

import { z } from 'zod';

const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

type Literal = z.infer<typeof literalSchema>;

type Json = Literal | { [key: string]: Json } | Json[];

const jsonSchema: z.ZodType<Json> = z.lazy(() =>
	z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)]),
);

/**
 zu.json() is a schema that validates that a JavaScript object is JSON-compatible. This includes `string`, `number`, `boolean`, and `null`, plus `Array`s and `Object`s containing JSON-compatible types as values.
 Note: `JSON.stringify()` enforces non-circularity, but this can't be easily checked without actually stringifying the results, which can be slow.
 @example
 import { zu } from 'zod_utilz'
 const schema = zu.json()
 schema.parse( false ) // false
 schema.parse( 8675309 ) // 8675309
 schema.parse( { a: 'deeply', nested: [ 'JSON', 'object' ] } )
 // { a: 'deeply', nested: [ 'JSON', 'object' ] }
 */
const json = () => jsonSchema;

// copied from https://github.com/colinhacks/zod/discussions/2215
export const stringToJSONSchema = z
	.string()
	.transform((str, ctx): z.infer<ReturnType<typeof json>> => {
		try {
			return JSON.parse(str);
		} catch (e) {
			ctx.addIssue({ code: 'custom', message: 'Invalid JSON' });
			return z.NEVER;
		}
	});
