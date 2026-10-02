import { validationSchema, formatValidationError } from './validation.schema';

describe('Configuration Validation Schema', () => {
  // Base valid configuration
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
    DATABASE_SYNCHRONIZE: true,
    DATABASE_LOGGING: true,
    JWT_SECRET: 'dev-jwt-secret-key-for-local-development-only-min-32-chars',
    JWT_EXPIRES_IN: '1h',
    JWT_REFRESH_SECRET: 'dev-refresh-secret-key-for-local-development-only-min-32-chars',
    JWT_REFRESH_EXPIRES_IN: '7d',
    JIRA_CLIENT_ID: 'test-client-id',
    JIRA_CLIENT_SECRET: 'test-client-secret',
    JIRA_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/jira/callback',
    JIRA_SCOPES: 'read:jira-work,write:jira-work,read:jira-user,manage:jira-webhook',
    WS_PORT: 3001,
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    WEBHOOK_SECRET: 'your-webhook-secret-min-32-chars',
  };

  describe('Valid Configuration', () => {
    it('should pass validation with all required fields', () => {
      const { error, value } = validationSchema.validate(validConfig);
      expect(error).toBeUndefined();
      expect(value).toBeDefined();
      expect(value.NODE_ENV).toBe('development');
      expect(value.PORT).toBe(3000);
    });

    it('should accept production environment', () => {
      const prodConfig = { ...validConfig, NODE_ENV: 'production' };
      const { error } = validationSchema.validate(prodConfig);
      expect(error).toBeUndefined();
    });

    it('should accept test environment', () => {
      const testConfig = { ...validConfig, NODE_ENV: 'test' };
      const { error } = validationSchema.validate(testConfig);
      expect(error).toBeUndefined();
    });

    it('should accept valid JWT_EXPIRES_IN values <= 1h', () => {
      const validExpirations = ['30m', '1h', '3600s', '59m', '3599s'];
      for (const exp of validExpirations) {
        const config = { ...validConfig, JWT_EXPIRES_IN: exp };
        const { error } = validationSchema.validate(config);
        expect(error).toBeUndefined();
      }
    });

    it('should accept valid JWT_EXPIRES_IN format with different units (<=1h)', () => {
      const validExpirations = ['30s', '30m', '59m', '1h', '3600s'];
      for (const exp of validExpirations) {
        const config = { ...validConfig, JWT_EXPIRES_IN: exp };
        const { error } = validationSchema.validate(config);
        expect(error).toBeUndefined();
      }
    });

    it('should reject JWT_EXPIRES_IN values > 1h (e.g., 1d, 90m, 7200s)', () => {
      const invalidExpirations = ['1d', '90m', '7200s', '2h'];
      for (const exp of invalidExpirations) {
        const config = { ...validConfig, JWT_EXPIRES_IN: exp };
        const { error } = validationSchema.validate(config);
        expect(error).toBeDefined();
      }
    });

    it('should accept valid JWT_REFRESH_EXPIRES_IN values', () => {
      const validExpirations = ['7d', '30d', '24h', '168h'];
      for (const exp of validExpirations) {
        const config = { ...validConfig, JWT_REFRESH_EXPIRES_IN: exp };
        const { error } = validationSchema.validate(config);
        expect(error).toBeUndefined();
      }
    });

    it('should accept valid DATABASE_PORT', () => {
      const config = { ...validConfig, DATABASE_PORT: 5433 };
      const { error } = validationSchema.validate(config);
      expect(error).toBeUndefined();
    });

    it('should accept valid WS_PORT', () => {
      const config = { ...validConfig, WS_PORT: 3002 };
      const { error } = validationSchema.validate(config);
      expect(error).toBeUndefined();
    });

    it('should accept valid TOKEN_ENCRYPTION_KEY (64 hex chars)', () => {
      const config = { ...validConfig, TOKEN_ENCRYPTION_KEY: '0'.repeat(64) };
      const { error } = validationSchema.validate(config);
      expect(error).toBeUndefined();
    });

    it('should accept valid FRONTEND_URL', () => {
      const config = { ...validConfig, FRONTEND_URL: 'https://app.example.com' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeUndefined();
    });

    it('should accept valid JIRA_REDIRECT_URI', () => {
      const config = { ...validConfig, JIRA_REDIRECT_URI: 'https://app.example.com/callback' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeUndefined();
    });
  });

  describe('Invalid Configuration - Missing Required Fields', () => {
    it('should fail when NODE_ENV is missing (required)', () => {
      const config = { ...validConfig };
      delete config.NODE_ENV;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when DATABASE_HOST is missing', () => {
      const config = { ...validConfig };
      delete config.DATABASE_HOST;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when DATABASE_USERNAME is missing', () => {
      const config = { ...validConfig };
      delete config.DATABASE_USERNAME;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when DATABASE_PASSWORD is missing', () => {
      const config = { ...validConfig };
      delete config.DATABASE_PASSWORD;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when DATABASE_NAME is missing', () => {
      const config = { ...validConfig };
      delete config.DATABASE_NAME;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JWT_SECRET is missing', () => {
      const config = { ...validConfig };
      delete config.JWT_SECRET;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JWT_REFRESH_SECRET is missing', () => {
      const config = { ...validConfig };
      delete config.JWT_REFRESH_SECRET;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JIRA_CLIENT_ID is missing', () => {
      const config = { ...validConfig };
      delete config.JIRA_CLIENT_ID;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JIRA_CLIENT_SECRET is missing', () => {
      const config = { ...validConfig };
      delete config.JIRA_CLIENT_SECRET;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JIRA_REDIRECT_URI is missing', () => {
      const config = { ...validConfig };
      delete config.JIRA_REDIRECT_URI;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when FRONTEND_URL is missing', () => {
      const config = { ...validConfig };
      delete config.FRONTEND_URL;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when TOKEN_ENCRYPTION_KEY is missing', () => {
      const config = { ...validConfig };
      delete config.TOKEN_ENCRYPTION_KEY;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when WEBHOOK_SECRET is missing', () => {
      const config = { ...validConfig };
      delete config.WEBHOOK_SECRET;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });
  });

  describe('Invalid Configuration - Invalid Values', () => {
    it('should fail when NODE_ENV is invalid', () => {
      const config = { ...validConfig, NODE_ENV: 'staging' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when PORT is not a valid port number', () => {
      const config = { ...validConfig, PORT: 99999 };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when DATABASE_PORT is not a valid port number', () => {
      const config = { ...validConfig, DATABASE_PORT: 99999 };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when WS_PORT is not a valid port number', () => {
      const config = { ...validConfig, WS_PORT: 99999 };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JWT_SECRET is too short', () => {
      const config = { ...validConfig, JWT_SECRET: 'short' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JWT_REFRESH_SECRET is too short', () => {
      const config = { ...validConfig, JWT_REFRESH_SECRET: 'short' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JWT_EXPIRES_IN exceeds 1h', () => {
      const config = { ...validConfig, JWT_EXPIRES_IN: '2h' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JWT_EXPIRES_IN is 90m (exceeds 1h)', () => {
      const config = { ...validConfig, JWT_EXPIRES_IN: '90m' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JWT_EXPIRES_IN is 7200s (exceeds 1h)', () => {
      const config = { ...validConfig, JWT_EXPIRES_IN: '7200s' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JWT_EXPIRES_IN has invalid format', () => {
      const config = { ...validConfig, JWT_EXPIRES_IN: 'invalid' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when TOKEN_ENCRYPTION_KEY is not 64 hex chars', () => {
      const config = { ...validConfig, TOKEN_ENCRYPTION_KEY: 'short' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when TOKEN_ENCRYPTION_KEY is not valid hex', () => {
      const config = { ...validConfig, TOKEN_ENCRYPTION_KEY: 'g'.repeat(64) };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when TOKEN_ENCRYPTION_KEY is 32 chars but not hex', () => {
      const config = { ...validConfig, TOKEN_ENCRYPTION_KEY: 'a'.repeat(32) };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when WEBHOOK_SECRET is too short', () => {
      const config = { ...validConfig, WEBHOOK_SECRET: 'short' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when FRONTEND_URL is not a valid URI', () => {
      const config = { ...validConfig, FRONTEND_URL: 'not-a-url' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JIRA_REDIRECT_URI is not a valid URI', () => {
      const config = { ...validConfig, JIRA_REDIRECT_URI: 'not-a-uri' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when DATABASE_HOST is not a valid hostname', () => {
      const config = { ...validConfig, DATABASE_HOST: 'invalid..host' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when DATABASE_PORT is 0', () => {
      const config = { ...validConfig, DATABASE_PORT: 0 };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when PORT is 0', () => {
      const config = { ...validConfig, PORT: 0 };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });

    it('should fail when JWT_EXPIRES_IN is 1d (exceeds 1h)', () => {
      const config = { ...validConfig, JWT_EXPIRES_IN: '1d' };
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();
    });
  });

  describe('Default Values', () => {
    it('should use default PORT when not provided', () => {
      const config = { ...validConfig };
      delete config.PORT;
      const { error, value } = validationSchema.validate(config);
      expect(error).toBeUndefined();
      expect(value.PORT).toBe(3000);
    });

    it('should use default API_PREFIX when not provided', () => {
      const config = { ...validConfig };
      delete config.API_PREFIX;
      const { error, value } = validationSchema.validate(config);
      expect(error).toBeUndefined();
      expect(value.API_PREFIX).toBe('api/v1');
    });

    it('should use default JWT_EXPIRES_IN when not provided', () => {
      const config = { ...validConfig };
      delete config.JWT_EXPIRES_IN;
      const { error, value } = validationSchema.validate(config);
      expect(error).toBeUndefined();
      expect(value.JWT_EXPIRES_IN).toBe('1h');
    });

    it('should use default JWT_REFRESH_EXPIRES_IN when not provided', () => {
      const config = { ...validConfig };
      delete config.JWT_REFRESH_EXPIRES_IN;
      const { error, value } = validationSchema.validate(config);
      expect(error).toBeUndefined();
      expect(value.JWT_REFRESH_EXPIRES_IN).toBe('7d');
    });

    it('should use default DATABASE_PORT when not provided', () => {
      const config = { ...validConfig };
      delete config.DATABASE_PORT;
      const { error, value } = validationSchema.validate(config);
      expect(error).toBeUndefined();
      expect(value.DATABASE_PORT).toBe(5432);
    });

    it('should use default WS_PORT when not provided', () => {
      const config = { ...validConfig };
      delete config.WS_PORT;
      const { error, value } = validationSchema.validate(config);
      expect(error).toBeUndefined();
      expect(value.WS_PORT).toBe(3001);
    });

    it('should use default JIRA_SCOPES when not provided', () => {
      const config = { ...validConfig };
      delete config.JIRA_SCOPES;
      const { error, value } = validationSchema.validate(config);
      expect(error).toBeUndefined();
      expect(value.JIRA_SCOPES).toBe(
        'read:jira-work,write:jira-work,read:jira-user,manage:jira-webhook',
      );
    });
  });

  describe('formatValidationError', () => {
    it('should format validation error correctly', () => {
      const config = { ...validConfig };
      delete config.JWT_SECRET;
      const { error } = validationSchema.validate(config);
      expect(error).toBeDefined();

      const formatted = formatValidationError(error);
      expect(formatted).toContain('JWT_SECRET');
    });
  });
});
