import { MAX_LAST_ERROR_LENGTH } from './outbox.constants';

/** Why a requeue was refused; the Admin API maps these to 404/409. */
export type OutboxRequeueRefusal = 'not_found' | 'not_dead' | 'blocked';

/** Raised by `OutboxService.requeue`; never carries row contents or provider bodies. */
export class OutboxOperationError extends Error {
  constructor(
    readonly refusal: OutboxRequeueRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'OutboxOperationError';
  }
}

const SECRET_PATTERNS: RegExp[] = [
  // Authorization headers and JWTs (three base64url segments).
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  // Query/parameter style credentials.
  /\b(token|access_token|api_key|apikey|password|secret)=([^&\s"']+)/gi,
];

/**
 * Redacts credentials and collapses a failure message into a single line of bounded length so a
 * provider body can never reach `sync_outbox.last_error`, the logs or the Admin API.
 */
export function sanitizeErrorMessage(message: string, limit = MAX_LAST_ERROR_LENGTH): string {
  let sanitized = String(message ?? '');
  for (const pattern of SECRET_PATTERNS) {
    // A pattern without capture groups passes the match offset as the second argument.
    sanitized = sanitized.replace(pattern, (match, key: unknown) =>
      typeof key === 'string' ? `${key}=[redacted]` : '[redacted]',
    );
  }
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  return sanitized.length > limit ? `${sanitized.slice(0, limit - 3)}...` : sanitized;
}
