/**
 * Environment for integration tests. Real values from the process environment win (CI and local
 * Docker Postgres set DATABASE_*); everything else gets a safe test default so the same schema
 * validation as production runs.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  API_PREFIX: 'api/v1',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_USERNAME: 'postgres',
  DATABASE_PASSWORD: 'postgres',
  DATABASE_NAME: 'boardsync_test',
  DATABASE_LOGGING: 'false',
  JWT_SECRET: 'integration-test-jwt-secret-with-at-least-32-chars',
  JWT_EXPIRES_IN: '1h',
  BCRYPT_ROUNDS: '10',
  JIRA_CLIENT_ID: 'test-client-id',
  JIRA_CLIENT_SECRET: 'test-client-secret',
  JIRA_REDIRECT_URI: 'http://localhost:5173/jira/callback',
  TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  WEBHOOK_SECRET: 'integration-test-webhook-secret-32-chars-min',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}

export {};
