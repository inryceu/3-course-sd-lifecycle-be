import { registerAs } from '@nestjs/config';

/**
 * App configuration namespace
 */
export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env['NODE_ENV'] || 'development',
  port: parseInt(process.env['PORT'] || '3000', 10),
  apiPrefix: process.env['API_PREFIX'] || 'api/v1',
  frontendUrl: process.env['FRONTEND_URL'] || 'http://localhost:5173',
}));

/**
 * Database configuration namespace
 */
export const databaseConfig = registerAs('database', () => ({
  host: process.env['DATABASE_HOST'] || 'localhost',
  port: parseInt(process.env['DATABASE_PORT'] || '5432', 10),
  username: process.env['DATABASE_USERNAME'] || 'postgres',
  password: process.env['DATABASE_PASSWORD'] || 'postgres',
  name: process.env['DATABASE_NAME'] || 'boardsync',
  synchronize: process.env['DATABASE_SYNCHRONIZE'] === 'true',
  logging: process.env['DATABASE_LOGGING'] === 'true',
}));

/**
 * JWT configuration namespace
 * JWT_EXPIRES_IN must be <= 1h (3600s) for security
 */
export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env['JWT_SECRET'] || 'secret',
  expiresIn: process.env['JWT_EXPIRES_IN'] || '1h',
  refreshSecret: process.env['JWT_REFRESH_SECRET'] || 'refresh-secret',
  refreshExpiresIn: process.env['JWT_REFRESH_EXPIRES_IN'] || '7d',
}));

/**
 * Jira OAuth 2.0 (3LO) configuration namespace
 */
export const jiraConfig = registerAs('jira', () => ({
  clientId: process.env['JIRA_CLIENT_ID'],
  clientSecret: process.env['JIRA_CLIENT_SECRET'],
  redirectUri: process.env['JIRA_REDIRECT_URI'],
  scopes: process.env['JIRA_SCOPES']?.split(',') || [
    'read:jira-work',
    'write:jira-work',
    'read:jira-user',
    'manage:jira-webhook',
  ],
}));

/**
 * Crypto configuration namespace
 * TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars) for AES-256
 */
export const cryptoConfig = registerAs('crypto', () => ({
  tokenEncryptionKey: process.env['TOKEN_ENCRYPTION_KEY'],
}));

/**
 * Webhook configuration namespace
 */
export const webhookConfig = registerAs('webhook', () => ({
  secret: process.env['WEBHOOK_SECRET'],
}));

/**
 * WebSocket configuration namespace
 */
export const websocketConfig = registerAs('websocket', () => ({
  port: parseInt(process.env['WS_PORT'] || '3001', 10),
}));

/**
 * All configuration namespaces combined for ConfigModule
 */
export const allConfigs = [
  appConfig,
  databaseConfig,
  jwtConfig,
  jiraConfig,
  cryptoConfig,
  webhookConfig,
  websocketConfig,
];
