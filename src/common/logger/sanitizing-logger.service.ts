import { ConsoleLogger, Injectable } from '@nestjs/common';

const REDACTED = '[REDACTED]';

// `token` and `secret` also cover accessToken, refreshToken, client_secret, clientSecret and the *_SECRET env names.
const SECRET_KEYS = [
  'JWT_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'WEBHOOK_SECRET',
  'JIRA_CLIENT_SECRET',
  'DATABASE_PASSWORD',
  'password',
  'accessToken',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'authorization',
  'token',
  'secret',
];

// key, optional closing quote, `=` or `:`, then the value: a quoted string or everything up to , newline or }.
const SECRET_PATTERN = new RegExp(
  String.raw`(["']?(?:${SECRET_KEYS.join('|')})["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^,\n}]*)`,
  'gi',
);

/**
 * Extends the Nest console logger and redacts known secret keys from every log write
 * before it reaches stdout. It extends `ConsoleLogger` instead of wrapping `Logger`:
 * installed through `app.useLogger`, a wrapper that calls `Logger` would call itself forever.
 */
@Injectable()
export class SanitizingLoggerService extends ConsoleLogger {
  private sanitize(value: unknown): unknown {
    if (typeof value === 'string') return value.replace(SECRET_PATTERN, `$1${REDACTED}`);
    if (value instanceof Error) return this.sanitize(value.stack ?? value.message);
    if (value !== null && typeof value === 'object') {
      try {
        return this.sanitize(JSON.stringify(value));
      } catch {
        return value;
      }
    }
    return value;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(this.sanitize(message), ...optionalParams.map((p) => this.sanitize(p)));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(this.sanitize(message), ...optionalParams.map((p) => this.sanitize(p)));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(this.sanitize(message), ...optionalParams.map((p) => this.sanitize(p)));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(this.sanitize(message), ...optionalParams.map((p) => this.sanitize(p)));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(this.sanitize(message), ...optionalParams.map((p) => this.sanitize(p)));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(this.sanitize(message), ...optionalParams.map((p) => this.sanitize(p)));
  }
}