import { Logger } from '@nestjs/common';
import {
  JiraClientError,
  JiraGatewayError,
  JiraRateLimitedError,
  JiraServerError,
  JiraTimeBudgetExceededError,
  JiraTimeoutError,
  JiraUnauthorizedError,
} from '../domain/jira-gateway.errors';
import { JiraRetryService } from './jira-retry.service';

describe('JiraRetryService', () => {
  let service: JiraRetryService;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new JiraRetryService();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('execute', () => {
    it('returns immediately on success without retrying', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await service.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 with retryAfterSeconds and uses that delay', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new JiraRateLimitedError(2))
        .mockResolvedValue('success');

      const start = Date.now();
      const result = await service.execute(fn, {
        deadlineMs: Date.now() + 10000,
        operationName: 'test',
        maxDelayMs: 3000,
      });
      const elapsed = Date.now() - start;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(elapsed).toBeGreaterThanOrEqual(1900);
      expect(elapsed).toBeLessThan(2500);
    });

    it('retries on 429 with null retryAfterSeconds using exponential backoff', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new JiraRateLimitedError(null))
        .mockResolvedValue('success');

      const start = Date.now();
      const result = await service.execute(fn, {
        deadlineMs: Date.now() + 10000,
        operationName: 'test',
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });
      const elapsed = Date.now() - start;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(elapsed).toBeLessThan(200);
    });

    it('retries on 5xx server errors with exponential backoff', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new JiraServerError(503, 1, 3))
        .mockResolvedValue('success');

      const start = Date.now();
      const result = await service.execute(fn, {
        deadlineMs: Date.now() + 10000,
        operationName: 'test',
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });
      const elapsed = Date.now() - start;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(elapsed).toBeLessThan(200);
    });

    it('retries on network errors (JiraGatewayError with null status)', async () => {
      const error = new JiraGatewayError('SERVER_ERROR', 'connection reset') as JiraGatewayError & {
        status: null;
      };
      error.status = null;

      const fn = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('success');

      const result = await service.execute(fn, {
        deadlineMs: Date.now() + 10000,
        operationName: 'test',
        baseDelayMs: 100,
        maxDelayMs: 1000,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 4xx client errors (except 408 and 429)', async () => {
      const fn = jest.fn().mockRejectedValue(new JiraClientError(400, 'Bad Request'));

      await expect(
        service.execute(fn, { deadlineMs: Date.now() + 10000, operationName: 'test' }),
      ).rejects.toThrow(JiraClientError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 404', async () => {
      const fn = jest.fn().mockRejectedValue(new JiraClientError(404, 'Not Found'));

      await expect(
        service.execute(fn, { deadlineMs: Date.now() + 10000, operationName: 'test' }),
      ).rejects.toThrow(JiraClientError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 403', async () => {
      const fn = jest.fn().mockRejectedValue(new JiraClientError(403, 'Forbidden'));

      await expect(
        service.execute(fn, { deadlineMs: Date.now() + 10000, operationName: 'test' }),
      ).rejects.toThrow(JiraClientError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on JiraUnauthorizedError', async () => {
      const fn = jest.fn().mockRejectedValue(new JiraUnauthorizedError('invalid token'));

      await expect(
        service.execute(fn, { deadlineMs: Date.now() + 10000, operationName: 'test' }),
      ).rejects.toThrow(JiraUnauthorizedError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on JiraTimeoutError', async () => {
      const fn = jest.fn().mockRejectedValue(new JiraTimeoutError(3, 3));

      await expect(
        service.execute(fn, { deadlineMs: Date.now() + 10000, operationName: 'test' }),
      ).rejects.toThrow(JiraTimeoutError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on JiraTimeBudgetExceededError', async () => {
      const fn = jest.fn().mockRejectedValue(new JiraTimeBudgetExceededError(100, 3));

      await expect(
        service.execute(fn, { deadlineMs: Date.now() + 10000, operationName: 'test' }),
      ).rejects.toThrow(JiraTimeBudgetExceededError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws when maxAttempts is exceeded', async () => {
      const fn = jest.fn().mockRejectedValue(new JiraServerError(503, 1, 3));

      await expect(
        service.execute(fn, {
          deadlineMs: Date.now() + 10000,
          operationName: 'test',
          maxAttempts: 3,
          baseDelayMs: 10,
          maxDelayMs: 50,
        }),
      ).rejects.toThrow(JiraServerError);

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws when deadlineMs is exceeded (SYNC_BUDGET_MS)', async () => {
      const deadline = Date.now() + 100;
      const fn = jest.fn().mockRejectedValue(new JiraServerError(503, 1, 3));

      await expect(
        service.execute(fn, {
          deadlineMs: deadline,
          operationName: 'test',
          maxAttempts: 10,
          baseDelayMs: 100,
          maxDelayMs: 500,
        }),
      ).rejects.toThrow(JiraServerError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not throw when remaining time minus delay equals MIN_RETRY_REMAINING_MS', async () => {
      // deadline is 500ms from now, baseDelayMs is 200, so remaining - delay = 300 = MIN_RETRY_REMAINING_MS
      // Since condition is "< MIN_RETRY_REMAINING_MS" (strictly less), it should NOT throw
      const deadline = Date.now() + 500;
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new JiraServerError(503, 1, 3))
        .mockResolvedValue('success');

      const result = await service.execute(fn, {
        deadlineMs: deadline,
        operationName: 'test',
        maxAttempts: 3,
        baseDelayMs: 200,
        maxDelayMs: 1500,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws when remaining time minus delay is less than MIN_RETRY_REMAINING_MS', async () => {
      // deadline is 350ms from now, baseDelayMs is 200, delay will be 100-200, so remaining - delay < 300
      const deadline = Date.now() + 350;
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new JiraServerError(503, 1, 3))
        .mockResolvedValue('success');

      await expect(
        service.execute(fn, {
          deadlineMs: deadline,
          operationName: 'test',
          maxAttempts: 3,
          baseDelayMs: 200,
          maxDelayMs: 1500,
        }),
      ).rejects.toThrow(JiraServerError);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('uses exponential backoff with jitter for server errors', async () => {
      const delays: number[] = [];
      (service as any).sleep = jest.fn((ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      });

      const fn = jest
        .fn()
        .mockRejectedValueOnce(new JiraServerError(503, 1, 3))
        .mockRejectedValueOnce(new JiraServerError(503, 2, 3))
        .mockResolvedValue('success');

      const result = await service.execute(fn, {
        deadlineMs: Date.now() + 10000,
        operationName: 'test',
        maxAttempts: 3,
        baseDelayMs: 200,
        maxDelayMs: 1500,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(delays).toHaveLength(2);
      expect(delays[0]).toBeGreaterThanOrEqual(100);
      expect(delays[0]).toBeLessThanOrEqual(200);
      expect(delays[1]).toBeGreaterThanOrEqual(200);
      expect(delays[1]).toBeLessThanOrEqual(400);
    });

    it('respects maxDelayMs cap', async () => {
      const delays: number[] = [];
      (service as any).sleep = jest.fn((ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      });

      const fn = jest
        .fn()
        .mockRejectedValueOnce(new JiraServerError(503, 1, 5))
        .mockRejectedValueOnce(new JiraServerError(503, 2, 5))
        .mockRejectedValueOnce(new JiraServerError(503, 3, 5))
        .mockResolvedValue('success');

      await service.execute(fn, {
        deadlineMs: Date.now() + 10000,
        operationName: 'test',
        maxAttempts: 5,
        baseDelayMs: 200,
        maxDelayMs: 300,
      });

      expect(delays[2]).toBeLessThanOrEqual(300);
    });

    it('logs warning on each retry attempt', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new JiraServerError(503, 1, 3))
        .mockResolvedValue('success');

      await service.execute(fn, {
        deadlineMs: Date.now() + 10000,
        operationName: 'test-call',
        baseDelayMs: 10,
        maxDelayMs: 50,
      });

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Transient Jira failure on test-call (attempt 1/3)'),
      );
    });
  });

  describe('isTransient', () => {
    it('returns true for JiraRateLimitedError', () => {
      expect(service.isTransient(new JiraRateLimitedError(2))).toBe(true);
    });

    it('returns true for JiraServerError', () => {
      expect(service.isTransient(new JiraServerError(503, 1, 3))).toBe(true);
    });

    it('returns true for JiraClientError with status 408', () => {
      expect(service.isTransient(new JiraClientError(408, 'Request Timeout'))).toBe(true);
    });

    it('returns true for JiraClientError with status 429', () => {
      expect(service.isTransient(new JiraClientError(429, 'Too Many Requests'))).toBe(true);
    });

    it('returns true for JiraGatewayError with null status', () => {
      const error = new JiraGatewayError('SERVER_ERROR', 'network error') as JiraGatewayError & {
        status: null;
      };
      error.status = null;
      expect(service.isTransient(error)).toBe(true);
    });

    it('returns true for JiraGatewayError with status >= 500', () => {
      const error = new JiraGatewayError('SERVER_ERROR', 'server error') as JiraGatewayError & {
        status: 502;
      };
      error.status = 502;
      expect(service.isTransient(error)).toBe(true);
    });

    it('returns false for JiraUnauthorizedError', () => {
      expect(service.isTransient(new JiraUnauthorizedError('invalid token'))).toBe(false);
    });

    it('returns false for JiraTimeBudgetExceededError', () => {
      expect(service.isTransient(new JiraTimeBudgetExceededError(100, 3))).toBe(false);
    });

    it('returns false for JiraTimeoutError', () => {
      expect(service.isTransient(new JiraTimeoutError(3, 3))).toBe(false);
    });

    it('returns false for JiraClientError with status 400', () => {
      expect(service.isTransient(new JiraClientError(400, 'Bad Request'))).toBe(false);
    });

    it('returns false for JiraClientError with status 404', () => {
      expect(service.isTransient(new JiraClientError(404, 'Not Found'))).toBe(false);
    });

    it('returns false for JiraClientError with status 403', () => {
      expect(service.isTransient(new JiraClientError(403, 'Forbidden'))).toBe(false);
    });

    it('returns false for unknown error types', () => {
      expect(service.isTransient(new Error('unknown'))).toBe(false);
      expect(service.isTransient('string error')).toBe(false);
      expect(service.isTransient(null)).toBe(false);
      expect(service.isTransient(undefined)).toBe(false);
    });
  });

  describe('computeDelayMs', () => {
    it('uses retryAfterSeconds when available for rate limited error', () => {
      const error = new JiraRateLimitedError(5);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delay = (service as any).computeDelayMs(error, 1, 200, 10000);
      expect(delay).toBe(5000);
    });

    it('caps retryAfterSeconds at maxDelayMs', () => {
      const error = new JiraRateLimitedError(10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delay = (service as any).computeDelayMs(error, 1, 200, 1500);
      expect(delay).toBe(1500);
    });

    it('minimum delay for rate limited is 50ms', () => {
      const error = new JiraRateLimitedError(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delay = (service as any).computeDelayMs(error, 1, 200, 1500);
      expect(delay).toBe(50);
    });

    it('uses exponential backoff for server errors', () => {
      const error = new JiraServerError(503, 1, 3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delay = (service as any).computeDelayMs(error, 1, 200, 1500);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(200);
    });

    it('increases delay with attempt number', () => {
      const error = new JiraServerError(503, 1, 3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delay1 = (service as any).computeDelayMs(error, 1, 200, 1500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delay2 = (service as any).computeDelayMs(error, 2, 200, 1500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delay3 = (service as any).computeDelayMs(error, 3, 200, 1500);
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });
  });
});
