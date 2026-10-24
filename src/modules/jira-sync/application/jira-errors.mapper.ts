import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  JiraClientError,
  JiraGatewayError,
  JiraRateLimitedError,
  JiraUnauthorizedError,
} from '../domain/jira-gateway.errors';

/**
 * Turns a gateway failure into the HTTP answer the API contract promises; anything that is not a
 * gateway error is rethrown unchanged.
 */
export function toHttpError(error: unknown): unknown {
  if (!(error instanceof JiraGatewayError)) {
    return error;
  }
  if (error instanceof JiraUnauthorizedError) {
    return new ConflictException(`Reconnect Jira for this board (${error.detail})`);
  }
  if (error instanceof JiraRateLimitedError) {
    return new HttpException(
      `Jira rate limit reached, retry in ${error.retryAfterSeconds ?? 'a few'} seconds`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (error instanceof JiraClientError) {
    if (error.status === 403 && error.providerError === 'missing_scope') {
      return new ForbiddenException('The Jira connection lacks a required permission (scope)');
    }
    if (error.status === 404) {
      return new BadRequestException('Jira project not found or not visible to this connection');
    }
    return new BadRequestException(`Jira rejected the request: ${error.providerError}`);
  }
  // Server errors, timeouts, exhausted time budget and token persistence failures.
  return new HttpException(`Jira is unavailable: ${error.message}`, HttpStatus.BAD_GATEWAY);
}
