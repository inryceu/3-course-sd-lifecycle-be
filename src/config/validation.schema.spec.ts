import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';
import { validationSchema, formatValidationError } from './validation.schema';
import { envFilePaths } from './env-files';

const validConfig = {
  NODE_ENV: 'development',
  PORT: 3000,
  API_PREFIX: 'api/v1',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: 5432,
  DATABASE_USERNAME: 'postgres',
  DATABASE_PASSWORD: 'postgres',
  DATABASE_NAME: 'boardsync',
  DATABASE_LOGGING: true,
  JWT_SECRET: 'dev-jwt-secret-key-for-local-development-only-min-32-chars',
  JWT_EXPIRES_IN: '1h',
  BCRYPT_ROUNDS: 10,
  JIRA_CLIENT_ID: 'test-client-id',
  JIRA_CLIENT_SECRET: 'test-client-secret',
  JIRA_REDIRECT_URI: 'http://localhost:5173/jira/callback',
  JIRA_SCOPES: 'read:jira-work,write:jira-work,read:jira-user,offline_access',
  TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  WEBHOOK_SECRET: 'your-webhook-secret-with-at-least-32-chars',
};

const validate = (config: Record<string, unknown>) =>
  validationSchema.validate(config, { abortEarly: false });

describe('Configuration validation schema', () => {
  describe('valid configuration', () => {
    it('accepts a complete configuration', () => {
      const { error, value } = validate(validConfig);
      expect(error).toBeUndefined();
      expect(value.PORT).toBe(3000);
    });

    it.each(['development', 'production', 'test'])('accepts NODE_ENV=%s', (nodeEnv) => {
      const redirect =
        nodeEnv === 'production' ? 'https://app.example.com/jira/callback' : undefined;
      const { error } = validate({
        ...validConfig,
        NODE_ENV: nodeEnv,
        ...(redirect ? { JIRA_REDIRECT_URI: redirect } : {}),
      });
      expect(error).toBeUndefined();
    });

    it.each(['30s', '30m', '59m', '1h', '3600s', '3599s'])(
      'accepts JWT_EXPIRES_IN=%s (<= 1h)',
      (lifetime) => {
        const { error } = validate({ ...validConfig, JWT_EXPIRES_IN: lifetime });
        expect(error).toBeUndefined();
      },
    );
  });

  describe('required variables', () => {
    const required = [
      'NODE_ENV',
      'FRONTEND_URL',
      'DATABASE_HOST',
      'DATABASE_USERNAME',
      'DATABASE_PASSWORD',
      'DATABASE_NAME',
      'JWT_SECRET',
      'JIRA_CLIENT_ID',
      'JIRA_CLIENT_SECRET',
      'JIRA_REDIRECT_URI',
      'TOKEN_ENCRYPTION_KEY',
      'WEBHOOK_SECRET',
    ];

    it.each(required)('rejects a configuration without %s', (name) => {
      const config: Record<string, unknown> = { ...validConfig };
      delete config[name];
      const { error } = validate(config);
      expect(error).toBeDefined();
      expect(formatValidationError(error)).toContain(name);
    });
  });

  describe('JWT', () => {
    it.each(['1d', '90m', '7200s', '2h', '3601s'])(
      'rejects JWT_EXPIRES_IN=%s (> 1h)',
      (lifetime) => {
        const { error } = validate({ ...validConfig, JWT_EXPIRES_IN: lifetime });
        expect(error).toBeDefined();
        expect(formatValidationError(error)).toContain('JWT_EXPIRES_IN');
      },
    );

    it('rejects a malformed lifetime', () => {
      expect(validate({ ...validConfig, JWT_EXPIRES_IN: 'one hour' }).error).toBeDefined();
    });

    it('rejects a JWT secret shorter than 32 characters', () => {
      const { error } = validate({ ...validConfig, JWT_SECRET: 'test-jwt-secret' });
      expect(error).toBeDefined();
      expect(formatValidationError(error)).toContain('JWT_SECRET');
    });

    it('defaults the lifetime to 1h', () => {
      const config: Record<string, unknown> = { ...validConfig };
      delete config['JWT_EXPIRES_IN'];
      expect(validate(config).value.JWT_EXPIRES_IN).toBe('1h');
    });
  });

  describe('bcrypt cost', () => {
    it('defaults to 10', () => {
      const config: Record<string, unknown> = { ...validConfig };
      delete config['BCRYPT_ROUNDS'];
      expect(validate(config).value.BCRYPT_ROUNDS).toBe(10);
    });

    it.each([9, 8, 4])('rejects BCRYPT_ROUNDS=%s (< 10)', (rounds) => {
      expect(validate({ ...validConfig, BCRYPT_ROUNDS: rounds }).error).toBeDefined();
    });

    it('rejects a cost that would freeze the server', () => {
      expect(validate({ ...validConfig, BCRYPT_ROUNDS: 20 }).error).toBeDefined();
    });
  });

  describe('encryption key and secrets', () => {
    it.each([
      ['too short', '0123456789abcdef'],
      ['not hex', 'z'.repeat(64)],
      ['too long', '0'.repeat(65)],
      ['the old development placeholder', 'dev-32-byte-hex-encryption-key-64-hex-chars-here'],
    ])('rejects TOKEN_ENCRYPTION_KEY that is %s', (_label, key) => {
      const { error } = validate({ ...validConfig, TOKEN_ENCRYPTION_KEY: key });
      expect(error).toBeDefined();
      expect(formatValidationError(error)).toContain('TOKEN_ENCRYPTION_KEY');
    });

    it('rejects a webhook secret shorter than 32 characters', () => {
      expect(validate({ ...validConfig, WEBHOOK_SECRET: 'short' }).error).toBeDefined();
    });
  });

  describe('other values', () => {
    it.each([0, 65536, -1])('rejects PORT=%s', (port) => {
      expect(validate({ ...validConfig, PORT: port }).error).toBeDefined();
    });

    it('rejects an unknown NODE_ENV', () => {
      expect(validate({ ...validConfig, NODE_ENV: 'staging' }).error).toBeDefined();
    });

    it('rejects a malformed FRONTEND_URL', () => {
      expect(validate({ ...validConfig, FRONTEND_URL: 'not a url' }).error).toBeDefined();
    });

    it('applies defaults for optional variables', () => {
      const config: Record<string, unknown> = { ...validConfig };
      for (const name of [
        'PORT',
        'API_PREFIX',
        'DATABASE_PORT',
        'DATABASE_LOGGING',
        'JIRA_SCOPES',
      ]) {
        delete config[name];
      }
      const { error, value } = validate(config);
      expect(error).toBeUndefined();
      expect(value.PORT).toBe(3000);
      expect(value.API_PREFIX).toBe('api/v1');
      expect(value.DATABASE_PORT).toBe(5432);
      expect(value.DATABASE_LOGGING).toBe(false);
      expect(value.JIRA_SCOPES).toContain('offline_access');
      expect(value.JIRA_AUTH_BASE_URL).toBe('https://auth.atlassian.com');
      expect(value.JIRA_API_BASE_URL).toBe('https://api.atlassian.com');
    });

    it('ignores variables that no longer exist (schema synchronisation cannot be enabled)', () => {
      const { error, value } = validationSchema.validate(
        { ...validConfig, DATABASE_SYNCHRONIZE: 'true' },
        { allowUnknown: true },
      );
      expect(error).toBeUndefined();
      expect(value.DATABASE_SYNCHRONIZE).toBe('true');
    });
  });

  describe('HTTPS in production', () => {
    const production = { ...validConfig, NODE_ENV: 'production' };

    it('rejects a plain-http Jira redirect URI', () => {
      const { error } = validate({ ...production, JIRA_REDIRECT_URI: 'http://app.example.com/cb' });
      expect(error).toBeDefined();
      expect(formatValidationError(error)).toContain('JIRA_REDIRECT_URI');
    });

    it('rejects plain-http Atlassian base URLs', () => {
      const redirect = { JIRA_REDIRECT_URI: 'https://app.example.com/jira/callback' };
      expect(
        validate({ ...production, ...redirect, JIRA_AUTH_BASE_URL: 'http://auth.example.com' })
          .error,
      ).toBeDefined();
      expect(
        validate({ ...production, ...redirect, JIRA_API_BASE_URL: 'http://api.example.com' }).error,
      ).toBeDefined();
    });

    it('accepts an https redirect URI', () => {
      const { error } = validate({
        ...production,
        JIRA_REDIRECT_URI: 'https://app.example.com/jira/callback',
      });
      expect(error).toBeUndefined();
    });

    it('allows http outside production (local development and stub servers)', () => {
      const { error } = validate({
        ...validConfig,
        JIRA_AUTH_BASE_URL: 'http://127.0.0.1:4010',
        JIRA_API_BASE_URL: 'http://127.0.0.1:4010',
      });
      expect(error).toBeUndefined();
    });
  });

  describe('error reporting', () => {
    it('reports every invalid variable in one message', () => {
      const { error } = validate({
        ...validConfig,
        DATABASE_HOST: 'not a host!',
        TOKEN_ENCRYPTION_KEY: 'bad',
      });
      const message = formatValidationError(error);
      expect(message).toContain('DATABASE_HOST');
      expect(message).toContain('TOKEN_ENCRYPTION_KEY');
    });
  });

  describe('committed environment files', () => {
    const read = (file: string) => parse(readFileSync(resolve(process.cwd(), file), 'utf8'));

    it('.env.example passes validation and documents every schema key', () => {
      const values = read('.env.example');
      const { error } = validate(values);
      expect(error).toBeUndefined();

      const schemaKeys = Object.keys(validationSchema.describe().keys);
      const text = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
      for (const key of schemaKeys) {
        expect(text).toContain(key);
      }
    });

    it('.env.dev passes validation', () => {
      const { error } = validate(read('.env.dev'));
      expect(error).toBeUndefined();
    });

    it('.env.prod contains placeholders instead of secrets', () => {
      const values = read('.env.prod');
      for (const secret of [
        'DATABASE_PASSWORD',
        'JWT_SECRET',
        'JIRA_CLIENT_SECRET',
        'TOKEN_ENCRYPTION_KEY',
        'WEBHOOK_SECRET',
      ]) {
        expect(values[secret]).toMatch(/^\$\{.+\}$/);
      }
    });
  });

  describe('env file resolution', () => {
    it('never loads the development file for production', () => {
      const files = envFilePaths('production').map((file) => file.replace(/\\/g, '/'));
      expect(files.some((file) => file.endsWith('/.env.dev'))).toBe(false);
      expect(files.some((file) => file.endsWith('/.env.prod'))).toBe(true);
    });

    it('lets git-ignored local overrides win over the committed development file', () => {
      const files = envFilePaths('development').map((file) => file.replace(/\\/g, '/'));
      expect(files.findIndex((f) => f.endsWith('/.env.local'))).toBeLessThan(
        files.findIndex((f) => f.endsWith('/.env.dev')),
      );
    });
  });
});
