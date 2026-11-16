import { SanitizingLoggerService } from './sanitizing-logger.service';
import { Logger } from '@nestjs/common';

describe('SanitizingLoggerService', () => {
  let service: SanitizingLoggerService;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new SanitizingLoggerService();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redacts JWT_SECRET from error messages', () => {
    service.error('JWT_SECRET=my-secret-value', 'stack trace', 'AuthModule');
    expect(errorSpy).toHaveBeenCalledWith('JWT_SECRET=[REDACTED]', 'stack trace', 'AuthModule');
  });

  it('redacts accessToken from log messages', () => {
    service.log('accessToken=eyJhbGciOiJIUzI1NiJ9', 'TokenService');
    expect(logSpy).toHaveBeenCalledWith('accessToken=[REDACTED]', 'TokenService');
  });

  it('redacts password from warn messages', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service.warn('password=supersecret');
    expect(warnSpy).toHaveBeenCalledWith('password=[REDACTED]', undefined);
    warnSpy.mockRestore();
  });

  it('redacts DATABASE_PASSWORD from error messages', () => {
    service.error('DATABASE_PASSWORD=db-secret', undefined, 'DatabaseModule');
    expect(errorSpy).toHaveBeenCalledWith(
      'DATABASE_PASSWORD=[REDACTED]',
      undefined,
      'DatabaseModule',
    );
  });

  it('redacts authorization header from debug messages', () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    service.debug('authorization: Bearer eyJhbGciOiJIUzI1NiJ9');
    expect(debugSpy).toHaveBeenCalledWith('authorization=[REDACTED]', undefined);
    debugSpy.mockRestore();
  });

  it('does not modify messages without secrets', () => {
    service.log('normal log message', 'TestModule');
    expect(logSpy).toHaveBeenCalledWith('normal log message', 'TestModule');
  });

  it('redacts multiple secrets in one message', () => {
    service.error('JWT_SECRET=abc123, DATABASE_PASSWORD=def456');
    expect(errorSpy).toHaveBeenCalledWith(
      'JWT_SECRET=[REDACTED], DATABASE_PASSWORD=[REDACTED]',
      undefined,
      undefined,
    );
  });
});
