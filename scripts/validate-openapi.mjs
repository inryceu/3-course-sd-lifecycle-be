import { readFileSync } from 'node:fs';
import { Validator } from '@seriousme/openapi-schema-validator';
import { parse } from 'yaml';

const file = process.argv[2] ?? 'docs/api/openapi.yaml';
const spec = parse(readFileSync(file, 'utf8'));
const validator = new Validator();
const result = await validator.validate(spec);

if (!result.valid) {
  console.error(`OpenAPI validation failed for ${file}`);
  console.error(JSON.stringify(result.errors, null, 2));
  process.exit(1);
}

const requiredTags = [
  'auth', 'boards', 'columns', 'cards', 'labels', 'comments', 'members', 'jira', 'notifications',
];
const tags = new Set((spec.tags ?? []).map((t) => t.name));
const missing = requiredTags.filter((t) => !tags.has(t));
if (missing.length > 0) {
  console.error(`Missing tags: ${missing.join(', ')}`);
  process.exit(1);
}

const operations = Object.values(spec.paths).flatMap((item) =>
  Object.entries(item).filter(([k]) => ['get', 'put', 'post', 'patch', 'delete'].includes(k)),
);
const ids = operations.map(([, op]) => op.operationId);
if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
  console.error('Every operation needs a unique operationId');
  process.exit(1);
}

console.log(`OpenAPI OK: ${operations.length} operations, ${tags.size} tags`);
