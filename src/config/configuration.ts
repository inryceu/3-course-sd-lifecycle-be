import { registerAs } from '@nestjs/config';

/**
 * Typed configuration namespaces. Values are validated by `validation.schema.ts`
 * before these factories run, so required values are always present here.
 * Secrets deliberately have no fallbacks.
 */

export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  frontendUrl: string;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
  bcryptRounds: number;
}

export interface JiraConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  authBaseUrl: string;
  apiBaseUrl: string;
}

export interface CryptoConfig {
  tokenEncryptionKey: string;
}

export interface WebhookConfig {
  secret: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  name: string;
  logging: boolean;
}

export const appConfig = registerAs('app', (): AppConfig => ({
  nodeEnv: process.env['NODE_ENV'],
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  apiPrefix: process.env['API_PREFIX'] ?? 'api/v1',
  frontendUrl: process.env['FRONTEND_URL'],
}));

export const databaseConfig = registerAs('database', (): DatabaseConfig => ({
  host: process.env['DATABASE_HOST'],
  port: parseInt(process.env['DATABASE_PORT'] ?? '5432', 10),
  username: process.env['DATABASE_USERNAME'],
  password: process.env['DATABASE_PASSWORD'],
  name: process.env['DATABASE_NAME'],
  logging: process.env['DATABASE_LOGGING'] === 'true',
}));

/** JWT access-token settings. `JWT_EXPIRES_IN` is validated to be at most 1h. */
export const jwtConfig = registerAs('jwt', (): JwtConfig => ({
  secret: process.env['JWT_SECRET'],
  expiresIn: process.env['JWT_EXPIRES_IN'] ?? '1h',
  bcryptRounds: parseInt(process.env['BCRYPT_ROUNDS'] ?? '10', 10),
}));

/** Jira OAuth 2.0 (3LO) settings. Base URLs are overridable so tests can use a stub server. */
export const jiraConfig = registerAs('jira', (): JiraConfig => ({
  clientId: process.env['JIRA_CLIENT_ID'],
  clientSecret: process.env['JIRA_CLIENT_SECRET'],
  redirectUri: process.env['JIRA_REDIRECT_URI'],
  scopes: (
    process.env['JIRA_SCOPES'] ?? 'read:jira-work,write:jira-work,read:jira-user,offline_access'
  )
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0),
  authBaseUrl: process.env['JIRA_AUTH_BASE_URL'] ?? 'https://auth.atlassian.com',
  apiBaseUrl: process.env['JIRA_API_BASE_URL'] ?? 'https://api.atlassian.com',
}));

/** `TOKEN_ENCRYPTION_KEY` is 32 bytes encoded as 64 hex characters (AES-256-GCM). */
export const cryptoConfig = registerAs('crypto', (): CryptoConfig => ({
  tokenEncryptionKey: process.env['TOKEN_ENCRYPTION_KEY'],
}));

export const webhookConfig = registerAs('webhook', (): WebhookConfig => ({
  secret: process.env['WEBHOOK_SECRET'],
}));

export const allConfigs = [
  appConfig,
  databaseConfig,
  jwtConfig,
  jiraConfig,
  cryptoConfig,
  webhookConfig,
];
