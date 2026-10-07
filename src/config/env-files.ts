import { resolve } from 'path';

const ENV_SUFFIX: Record<string, string> = {
  development: 'dev',
  production: 'prod',
  test: 'test',
};

/**
 * Environment files to load, highest priority first (dotenv and ConfigModule never override a
 * variable that is already set). Real secrets belong in the git-ignored `.env.local` / `.env`
 * or in the process environment; the committed `.env.dev` / `.env.prod` hold placeholders only.
 * A development file is never loaded for another environment, so a missing production secret
 * cannot silently fall back to a development value.
 */
export function envFilePaths(nodeEnv: string = process.env['NODE_ENV'] || 'development'): string[] {
  const suffix = ENV_SUFFIX[nodeEnv] ?? nodeEnv;
  return [`.env.${suffix}.local`, '.env.local', `.env.${suffix}`, '.env'].map((file) =>
    resolve(process.cwd(), file),
  );
}
