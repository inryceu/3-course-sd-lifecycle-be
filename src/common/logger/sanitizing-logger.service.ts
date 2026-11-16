import { Injectable, Logger, LoggerService } from '@nestjs/common';

const REDACTED = '[REDACTED]';

const SECRET_KEYS = [
  'JWT_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'WEBHOOK_SECRET',
  'JIRA_CLIENT_SECRET',
  'DATABASE_PASSWORD',
  'password',
  'accessToken',
  'authorization',
];

const SECRET_KEY_PATTERN = SECRET_KEYS.join('|');
const SECRET_PATTERN = new RegExp(`(${SECRET_KEY_PATTERN})[=:][^,\\n}]*`, 'gi');

/**
 * Wraps NestJS `Logger` and redacts known secret keys from every log write
 * before the message reaches stdout, so secrets, tokens and passwords never
 * appear in log output.
 */
@Injectable()
export class SanitizingLoggerService implements LoggerService {
  private readonly logger = new Logger('BoardSync');

  private sanitize(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    return value.replace(SECRET_PATTERN, `$1=${REDACTED}`);
  }

  log(message: string, context?: string): void {
    this.logger.log(this.sanitize(message), this.sanitize(context));
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error(
      this.sanitize(message),
      this.sanitize(trace),
      this.sanitize(context),
    );
  }

  warn(message: string, context?: string): void {
    this.logger.warn(this.sanitize(message), this.sanitize(context));
  }

  debug(message: string, context?: string): void {
    this.logger.debug(this.sanitize(message), this.sanitize(context));
  }

  verbose(message: string, context?: string): void {
    this.logger.verbose(this.sanitize(message), this.sanitize(context));
  }
}
