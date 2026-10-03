/**
 * Module boundary rules (docs/architecture/module-structure.md), shared by `.eslintrc.js` and the
 * boundary test (`src/architecture/module-boundaries.spec.ts`) so both always use one definition.
 *
 * Rules, per module M:
 * - M may import another module X only through its public API (`../../X`, i.e. its index.ts).
 *   Any deeper path (`../../X/application/...`, `.../X/infrastructure/*.entity`) is rejected, which
 *   also rejects cross-module access to entities and repositories.
 * - Allowed dependency direction: boards -> auth; jira-sync -> auth, boards; realtime -> auth only
 *   (plus the shared kernel `common`); auth and health depend on no other module.
 * - `forwardRef()` is banned everywhere: a circular dependency means a boundary is wrong.
 */

const MODULES = ['auth', 'boards', 'jira-sync', 'realtime', 'health'];

/** module -> modules whose public API it may import. */
const ALLOWED_DEPENDENCIES = {
  auth: [],
  boards: ['auth'],
  'jira-sync': ['auth', 'boards'],
  realtime: ['auth'],
  health: [],
};

const FORWARD_REF = {
  name: '@nestjs/common',
  importNames: ['forwardRef'],
  message: 'forwardRef() is not allowed: a circular dependency means a boundary was drawn wrongly.',
};

function restrictionFor(module) {
  const patterns = [];
  for (const other of MODULES.filter((name) => name !== module)) {
    if (ALLOWED_DEPENDENCIES[module].includes(other)) {
      patterns.push({
        group: [`**/${other}/**`],
        message: `Import "${other}" only through its public API (its index.ts), never a deeper path or its entities/repositories.`,
      });
    } else {
      patterns.push({
        group: [`**/${other}`, `**/${other}/**`],
        message: `Module "${module}" must not depend on module "${other}" (see docs/architecture/module-structure.md).`,
      });
    }
  }
  return ['error', { paths: [FORWARD_REF], patterns }];
}

const boundaryOverrides = MODULES.map((module) => ({
  files: [`src/modules/${module}/**/*.ts`],
  rules: { 'no-restricted-imports': restrictionFor(module) },
}));

/** Applies to files outside src/modules (common, config, app): only the forwardRef ban. */
const globalRestrictedImports = ['error', { paths: [FORWARD_REF] }];

const forwardRefCalls = [
  'error',
  {
    selector: "CallExpression[callee.name='forwardRef']",
    message: 'forwardRef() is not allowed: a circular dependency means a boundary was drawn wrongly.',
  },
];

module.exports = {
  MODULES,
  ALLOWED_DEPENDENCIES,
  boundaryOverrides,
  globalRestrictedImports,
  forwardRefCalls,
};
