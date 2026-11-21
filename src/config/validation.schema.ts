import * as Joi from 'joi';

const DURATION_PATTERN = /^(\d+)([smhd])$/;
const SECONDS_PER_UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
const MAX_ACCESS_TOKEN_SECONDS = 3600;

const accessTokenLifetime = Joi.string()
  .pattern(DURATION_PATTERN)
  .custom((value: string, helpers) => {
    const match = DURATION_PATTERN.exec(value);
    if (!match) return helpers.error('any.invalid');
    const seconds = parseInt(match[1], 10) * SECONDS_PER_UNIT[match[2]];
    if (seconds > MAX_ACCESS_TOKEN_SECONDS) {
      return helpers.error('any.custom', {
        error: new Error('JWT_EXPIRES_IN must be <= 1h (3600s)'),
      });
    }
    return value;
  })
  .default('1h');

const isProduction = Joi.valid('production');

const placeholderPatterns = ['change-me', 'default', 'example', 'your-', 'placeholder'];

const noPlaceholderSecret = Joi.string()
  .min(32)
  .custom((value: string, helpers) => {
    const lower = value.toLowerCase();
    if (placeholderPatterns.some((pattern) => lower.includes(pattern))) {
      return helpers.error('any.invalid', {
        error: new Error('JWT_SECRET must not look like a placeholder value in production'),
      });
    }
    return value;
  });

/**
 * Validation schema for environment variables.
 * The application refuses to start when a required variable is missing or invalid.
 * Secrets have no defaults on purpose.
 */
export const validationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
  PORT: Joi.number().port().min(1).default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  FRONTEND_URL: Joi.string().uri().required(),
  // Number of reverse proxies in front of the app (nginx = 1); makes req.ip the real client.
  TRUST_PROXY: Joi.number().integer().min(0).default(0),
  // Rate limits per client (T-36): global per minute, register/login per 5 minutes.
  RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(1).default(100),
  RATE_LIMIT_REGISTER: Joi.number().integer().min(1).default(5),
  RATE_LIMIT_LOGIN: Joi.number().integer().min(1).default(10),

  // Database
  DATABASE_HOST: Joi.string().hostname().required(),
  DATABASE_PORT: Joi.number().port().min(1).default(5432),
  DATABASE_USERNAME: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_LOGGING: Joi.boolean().default(false),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).default(10),

  // Authentication
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .when('NODE_ENV', {
      is: isProduction,
      then: noPlaceholderSecret,
      otherwise: Joi.string().min(32).required(),
    }),
  JWT_EXPIRES_IN: accessTokenLifetime,
  BCRYPT_ROUNDS: Joi.number().integer().min(10).max(15).default(10),

  // Jira OAuth 2.0 (3LO)
  JIRA_CLIENT_ID: Joi.string().required(),
  JIRA_CLIENT_SECRET: Joi.string().required(),
  JIRA_REDIRECT_URI: Joi.string()
    .uri()
    .required()
    .when('NODE_ENV', {
      is: isProduction,
      then: Joi.string().uri({ scheme: ['https'] }),
    }),
  JIRA_SCOPES: Joi.string().default(
    'read:jira-work,write:jira-work,read:jira-user,manage:jira-webhook,offline_access',
  ),
  JIRA_WEBHOOK_URL: Joi.string()
    .uri()
    .optional()
    .when('NODE_ENV', { is: isProduction, then: Joi.string().uri({ scheme: ['https'] }) }),
  JIRA_AUTH_BASE_URL: Joi.string()
    .uri()
    .default('https://auth.atlassian.com')
    .when('NODE_ENV', { is: isProduction, then: Joi.string().uri({ scheme: ['https'] }) }),
  JIRA_API_BASE_URL: Joi.string()
    .uri()
    .default('https://api.atlassian.com')
    .when('NODE_ENV', { is: isProduction, then: Joi.string().uri({ scheme: ['https'] }) }),

  // Crypto - TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars) for AES-256-GCM
  TOKEN_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),

  // Webhook
  WEBHOOK_SECRET: Joi.string().min(32).required(),

  // Deadline reminders: seconds between scheduler runs, 0 turns the scheduler off
  REMINDER_INTERVAL_SECONDS: Joi.number().integer().min(0).default(60),
}).required();

/** Converts a Joi validation error to one readable message listing every problem. */
export function formatValidationError(error: Joi.ValidationError): string {
  return error.details.map((detail) => `${detail.path.join('.')}: ${detail.message}`).join('; ');
}
