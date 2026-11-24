import { Injectable, Logger } from '@nestjs/common';
import {
  JiraClientError,
  JiraGatewayError,
  JiraRateLimitedError,
  JiraServerError,
  JiraTimeBudgetExceededError,
  JiraTimeoutError,
  JiraUnauthorizedError,
} from '../domain/jira-gateway.errors';

export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly deadlineMs?: number;
  readonly operationName?: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_MAX_DELAY_MS = 1_500;
const MIN_RETRY_REMAINING_MS = 300;

@Injectable()
export class JiraRetryService {
  private readonly logger = new Logger(JiraRetryService.name);

  /**
   * Executes an outbound Jira operation with exponential backoff + full jitter
   * for transient errors (429, 5xx, network errors), respecting the time budget.
   */
  async execute<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    const label = options.operationName ?? 'jira-call';

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      try {
        return await fn();
      } catch (error) {
        if (attempt >= maxAttempts || !this.isTransient(error)) {
          throw error;
        }

        const delayMs = this.computeDelayMs(error, attempt, baseDelayMs, maxDelayMs);
        if (options.deadlineMs !== undefined) {
          const remaining = options.deadlineMs - Date.now();
          if (remaining - delayMs < MIN_RETRY_REMAINING_MS) {
            throw error;
          }
        }

        this.logger.warn(
          `Transient Jira failure on ${label} (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.sleep(delayMs);
      }
    }
  }

  isTransient(error: unknown): boolean {
    if (
      error instanceof JiraUnauthorizedError ||
      error instanceof JiraTimeBudgetExceededError ||
      error instanceof JiraTimeoutError
    ) {
      // Do not retry POST timeouts because Jira may have already applied the mutation.
      return false;
    }
    if (error instanceof JiraRateLimitedError || error instanceof JiraServerError) {
      return true;
    }
    if (error instanceof JiraClientError) {
      return error.status === 408 || error.status === 429;
    }
    if (error instanceof JiraGatewayError) {
      // Network / DNS / connection reset errors without an HTTP client status
      const gatewayError = error as JiraRateLimitedError | JiraServerError;
      return gatewayError.status === null || gatewayError.status >= 500;
    }
    return false;
  }

  private computeDelayMs(
    error: unknown,
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number,
  ): number {
    if (error instanceof JiraRateLimitedError && error.retryAfterSeconds !== null) {
      return Math.min(Math.max(50, error.retryAfterSeconds * 1000), maxDelayMs);
    }
    const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    // Full jitter in [exp / 2, exp]
    return Math.floor(exp / 2 + Math.random() * (exp / 2));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
