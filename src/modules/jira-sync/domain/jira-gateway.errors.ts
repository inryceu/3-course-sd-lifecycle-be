/** Stable error codes exposed by the Jira gateway. */
export type JiraGatewayErrorCode =
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'CLIENT_ERROR'
  | 'TIMEOUT'
  | 'TIME_BUDGET_EXCEEDED'
  | 'PERSISTENCE_ERROR';

/** Base class for all typed Jira gateway failures. */
export abstract class JiraGatewayError extends Error {
  protected constructor(
    readonly code: JiraGatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The connection must be reconnected or the access token was rejected. */
export class JiraUnauthorizedError extends JiraGatewayError {
  constructor(readonly detail: string) {
    super('UNAUTHORIZED', `Jira authentication failed: ${detail}`);
  }
}

/** Jira responded with 429 and the gateway could not or would not wait. */
export class JiraRateLimitedError extends JiraGatewayError {
  readonly status = 429;

  constructor(readonly retryAfterSeconds: number | null) {
    super('RATE_LIMITED', `Jira rate limited (retry-after: ${retryAfterSeconds ?? 'unknown'})`);
  }
}

/** Jira (or the network) failed and the retry policy was exhausted. */
export class JiraServerError extends JiraGatewayError {
  constructor(
    readonly status: number,
    readonly attempts: number,
    readonly maxAttempts: number,
  ) {
    super(
      'SERVER_ERROR',
      `Jira server error (HTTP ${status}), attempts ${attempts}/${maxAttempts}`,
    );
  }
}

/** Jira rejected the request with a non-retryable 4xx response. */
export class JiraClientError extends JiraGatewayError {
  constructor(
    readonly status: number,
    readonly providerError: string,
    readonly errorMessages: readonly string[] = [],
    readonly fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super('CLIENT_ERROR', `Jira client error: ${providerError} (HTTP ${status})`);
  }
}

/** A request timed out and the retry policy was exhausted. */
export class JiraTimeoutError extends JiraGatewayError {
  constructor(
    readonly attempts: number,
    readonly maxAttempts: number,
  ) {
    super('TIMEOUT', `Jira request timed out after ${attempts}/${maxAttempts} attempts`);
  }
}

/** The per-call time budget was exhausted before the next attempt or wait. */
export class JiraTimeBudgetExceededError extends JiraGatewayError {
  constructor(
    readonly timeBudgetMs: number,
    readonly attempts: number,
  ) {
    super(
      'TIME_BUDGET_EXCEEDED',
      `Jira call exceeded its ${timeBudgetMs}ms budget after ${attempts} attempts`,
    );
  }
}

/** Rotated tokens could not be persisted after both attempts. */
export class JiraPersistenceError extends JiraGatewayError {
  constructor(
    readonly attempts: number,
    readonly maxAttempts: number,
  ) {
    super(
      'PERSISTENCE_ERROR',
      `Failed to persist refreshed Jira tokens after ${attempts}/${maxAttempts} attempts`,
    );
  }
}
