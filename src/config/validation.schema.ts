import * as Joi from '@hapi/joi';

/**
 * Validation schema for environment variables.
 * Ensures the app fails fast on missing or invalid configuration.
 */
export const validationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
  PORT: Joi.number().port().min(1).default(3000),
  API_PREFIX: Joi.string().default('api/v1'),

  // Database
  DATABASE_HOST: Joi.string().hostname().required(),
  DATABASE_PORT: Joi.number().port().min(1).default(5432),
  DATABASE_USERNAME: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_SYNCHRONIZE: Joi.boolean().default(false),
  DATABASE_LOGGING: Joi.boolean().default(false),

  // JWT - expiresIn must be <= 1h (3600s) for security
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .custom((value, helpers) => {
      const match = value.match(/^(\d+)([smhd])$/);
      if (!match) return helpers.error('any.invalid');
      const value_num = parseInt(match[1], 10);
      const unit = match[2];
      let seconds = 0;
      switch (unit) {
        case 's':
          seconds = value_num;
          break;
        case 'm':
          seconds = value_num * 60;
          break;
        case 'h':
          seconds = value_num * 3600;
          break;
        case 'd':
          seconds = value_num * 86400;
          break;
      }
      if (seconds > 3600) {
        return helpers.error('any.invalid', { message: 'JWT_EXPIRES_IN must be <= 1h (3600s)' });
      }
      return value;
    })
    .default('1h'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('7d'),

  // Jira OAuth 2.0 (3LO)
  JIRA_CLIENT_ID: Joi.string().required(),
  JIRA_CLIENT_SECRET: Joi.string().required(),
  JIRA_REDIRECT_URI: Joi.string().uri().required(),
  JIRA_SCOPES: Joi.string().default(
    'read:jira-work,write:jira-work,read:jira-user,manage:jira-webhook',
  ),

  // Frontend URL (for CORS)
  FRONTEND_URL: Joi.string().uri().required(),

  // WebSocket
  WS_PORT: Joi.number().port().min(1).default(3001),

  // Crypto - TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars) for AES-256
  TOKEN_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),

  // Webhook
  WEBHOOK_SECRET: Joi.string().min(32).required(),
}).required();

// Helper to convert Joi validation error to readable message
export function formatValidationError(error: Joi.ValidationError): string {
  return error.details.map((detail) => `${detail.path.join('.')}: ${detail.message}`).join('; ');
}
