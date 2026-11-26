// Runs the Postman collection in test/postman/ with Newman (T-56 / KAN-67).
//   pnpm test:api                  -> local environment (http://localhost:8090/api/v1)
//   pnpm test:api -- --env ci      -> CI environment (http://localhost:8080/api/v1)
// API_BASE_URL overrides the environment's baseUrl.
//
// The response schemas are NOT stored in the collection: they are built from the components of
// docs/api/openapi.yaml on every run and passed in as the `schemas` variable, so they cannot drift.
import { readFileSync, mkdirSync } from 'node:fs';
import newman from 'newman';
import { parse } from 'yaml';

const envName = process.argv.includes('--env')
  ? process.argv[process.argv.indexOf('--env') + 1]
  : 'local';
const spec = parse(readFileSync('docs/api/openapi.yaml', 'utf8'));
const components = spec.components.schemas;

// OpenAPI 3.0 schema -> JSON Schema: inline $ref, nullable -> type array, drop OpenAPI-only keys.
function convert(node) {
  if (Array.isArray(node)) return node.map(convert);
  if (node === null || typeof node !== 'object') return node;
  if (node.$ref) return convert(components[node.$ref.split('/').pop()]);
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'nullable' || key === 'example' || key === 'description') continue;
    out[key] =
      key === 'properties'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)]))
        : convert(value);
  }
  if (node.nullable && out.type) out.type = [out.type, 'null'];
  if (node.nullable && out.enum) out.enum = [...out.enum, null];
  return out;
}
const schemas = Object.fromEntries(
  Object.keys(components).map((name) => [name, convert(components[name])]),
);

mkdirSync('test-results', { recursive: true });
newman.run(
  {
    collection: 'test/postman/boardsync.postman_collection.json',
    environment: `test/postman/${envName}.postman_environment.json`,
    envVar: [
      { key: 'schemas', value: JSON.stringify(schemas) },
      ...(process.env.API_BASE_URL ? [{ key: 'baseUrl', value: process.env.API_BASE_URL }] : []),
    ],
    reporters: ['cli', 'junit'],
    reporter: { junit: { export: 'test-results/api-tests.xml' } },
  },
  (err, summary) => {
    if (err || summary.run.failures.length > 0) process.exit(1);
  },
);
