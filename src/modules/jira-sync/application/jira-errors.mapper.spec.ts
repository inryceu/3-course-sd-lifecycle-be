import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import {
  JiraClientError,
  JiraPersistenceError,
  JiraRateLimitedError,
  JiraServerError,
  JiraTimeBudgetExceededError,
  JiraTimeoutError,
  JiraUnauthorizedError,
} from '../domain/jira-gateway.errors';
import { toHttpError } from './jira-errors.mapper';

describe('toHttpError', () => {
  it('rethrows anything that is not a gateway error unchanged', () => {
    const plain = new Error('boom');
    expect(toHttpError(plain)).toBe(plain);
    expect(toHttpError('text')).toBe('text');
  });

  it('answers 409 "reconnect" for a rejected connection', () => {
    const result = toHttpError(new JiraUnauthorizedError('reconnect required'));
    expect(result).toBeInstanceOf(ConflictException);
    expect((result as ConflictException).message).toContain('reconnect required');
  });

  it('answers 429 and names the wait', () => {
    const result = toHttpError(new JiraRateLimitedError(30)) as HttpException;
    expect(result.getStatus()).toBe(429);
    expect(result.message).toContain('30 seconds');
    expect((toHttpError(new JiraRateLimitedError(null)) as HttpException).message).toContain(
      'a few seconds',
    );
  });

  it('answers 403 only for a missing scope, 400 for other client errors', () => {
    expect(toHttpError(new JiraClientError(403, 'missing_scope'))).toBeInstanceOf(
      ForbiddenException,
    );
    const forbidden = toHttpError(new JiraClientError(403, 'forbidden'));
    expect(forbidden).toBeInstanceOf(BadRequestException);
    expect((forbidden as BadRequestException).message).toContain('forbidden');
    // missing_scope on another status is not a permission problem of the connection
    expect(toHttpError(new JiraClientError(400, 'missing_scope'))).toBeInstanceOf(
      BadRequestException,
    );
  });

  it('answers 400 "project not found" for a 404 from Jira', () => {
    const result = toHttpError(new JiraClientError(404, 'not_found'));
    expect(result).toBeInstanceOf(BadRequestException);
    expect((result as BadRequestException).message).toContain('not found');
  });

  it.each([
    new JiraServerError(503, 3, 3),
    new JiraTimeoutError(3, 3),
    new JiraTimeBudgetExceededError(5000, 1),
    new JiraPersistenceError(2, 2),
  ])('answers 502 for %p', (error) => {
    expect((toHttpError(error) as HttpException).getStatus()).toBe(502);
  });
});
