import { join } from 'path';
import { ESLint, Linter } from 'eslint';

/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const boundaries = require('../../eslint-boundaries') as {
  MODULES: string[];
  boundaryOverrides: Linter.ConfigOverride[];
  globalRestrictedImports: Linter.RuleEntry;
  forwardRefCalls: Linter.RuleEntry;
};

const root = join(__dirname, '..', '..');

/** Lints with the real boundary definitions but without type information, so virtual files work. */
function eslint(overrides: Linter.ConfigOverride[] = boundaries.boundaryOverrides) {
  // eslintrc-style options (ESLint 8); the installed typings describe the flat config only.
  const options = {
    cwd: root,
    useEslintrc: false,
    overrideConfig: {
      parser: '@typescript-eslint/parser',
      parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
      rules: {
        'no-restricted-imports': boundaries.globalRestrictedImports,
        'no-restricted-syntax': boundaries.forwardRefCalls,
      },
      overrides,
    },
  };
  return new ESLint(options as unknown as ConstructorParameters<typeof ESLint>[0]);
}

async function lint(file: string, code: string, linter = eslint()): Promise<string[]> {
  const [result] = await linter.lintText(code, { filePath: join(root, file) });
  return result.messages
    .filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax')
    .map((m) => m.message);
}

describe('module boundaries', () => {
  describe('public API only', () => {
    it('accepts an import through the public index', async () => {
      const errors = await lint(
        'src/modules/boards/presentation/x.ts',
        "import { AUTH_FACADE } from '../../auth';",
      );
      expect(errors).toEqual([]);
    });

    it('rejects a deep import into another module', async () => {
      const errors = await lint(
        'src/modules/boards/presentation/x.ts',
        "import { AuthService } from '../../auth/application/auth.service';",
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/public API/);
    });

    it("rejects importing another module's entity", async () => {
      const errors = await lint(
        'src/modules/jira-sync/application/x.ts',
        "import { CardEntity } from '../../boards/infrastructure/persistence/card.entity';",
      );
      expect(errors).toHaveLength(1);
    });

    it("rejects importing another module's repository or alias path", async () => {
      const errors = await lint(
        'src/modules/jira-sync/application/x.ts',
        "import { R } from '@modules/boards/infrastructure/board.repository';",
      );
      expect(errors).toHaveLength(1);
    });

    it('allows imports inside the same module and from the shared kernel', async () => {
      const errors = await lint(
        'src/modules/boards/application/x.ts',
        [
          "import { BoardEntity } from '../infrastructure/persistence/board.entity';",
          "import { EVENT_PUBLISHER } from '../../../common/events';",
        ].join('\n'),
      );
      expect(errors).toEqual([]);
    });
  });

  describe('dependency direction', () => {
    it.each([
      ['auth', 'boards'],
      ['auth', 'jira-sync'],
      ['auth', 'realtime'],
      ['boards', 'jira-sync'],
      ['boards', 'realtime'],
      ['realtime', 'boards'],
      ['realtime', 'jira-sync'],
      ['health', 'auth'],
      ['health', 'boards'],
    ])('%s must not import %s', async (from, to) => {
      const errors = await lint(
        `src/modules/${from}/application/x.ts`,
        `import { X } from '../../${to}';`,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/must not depend/);
    });

    it.each([
      ['boards', 'auth'],
      ['jira-sync', 'auth'],
      ['jira-sync', 'boards'],
      ['realtime', 'auth'],
    ])('%s may import %s through its index', async (from, to) => {
      expect(
        await lint(`src/modules/${from}/application/x.ts`, `import { X } from '../../${to}';`),
      ).toEqual([]);
    });
  });

  describe('forwardRef', () => {
    it('rejects importing forwardRef', async () => {
      const errors = await lint(
        'src/modules/boards/boards.module.ts',
        "import { forwardRef } from '@nestjs/common';",
      );
      expect(errors.join(' ')).toMatch(/forwardRef/);
    });

    it('rejects calling forwardRef outside modules too', async () => {
      const errors = await lint('src/app.module.ts', 'const x = forwardRef(() => Y);');
      expect(errors.join(' ')).toMatch(/forwardRef/);
    });
  });

  describe('the test is not vacuous', () => {
    it('stops failing when a boundary pattern is removed', async () => {
      const code = "import { AuthService } from '../../auth/application/auth.service';";
      const file = 'src/modules/boards/presentation/x.ts';
      expect(await lint(file, code)).toHaveLength(1);

      const loosened = boundaries.boundaryOverrides.map((override) =>
        override.files.toString().includes('/boards/') ? { ...override, rules: {} } : override,
      );
      expect(await lint(file, code, eslint(loosened))).toEqual([]);
    });
  });

  describe('the repository itself', () => {
    it('has no boundary violations in src', async () => {
      const results = await eslint().lintFiles(['src/**/*.ts']);
      const violations = results.flatMap((result) =>
        result.messages
          .filter(
            (m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax',
          )
          .map((m) => `${result.filePath}:${m.line} ${m.message}`),
      );
      expect(violations).toEqual([]);
    });

    it('documents every module in the rules', () => {
      expect(boundaries.MODULES.sort()).toEqual([
        'auth',
        'boards',
        'health',
        'jira-sync',
        'realtime',
      ]);
    });
  });
});
