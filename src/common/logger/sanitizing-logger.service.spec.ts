import { Logger } from '@nestjs/common';
import { SanitizingLoggerService } from './sanitizing-logger.service';

describe('SanitizingLoggerService', () => {
  let service: SanitizingLoggerService;
  let out: jest.SpyInstance;

  beforeEach(() => {
    service = new SanitizingLoggerService();
    // ConsoleLogger writes through process.stdout/stderr; capture instead of printing.
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
  });

  const written = () => out.mock.calls.map((c) => String(c[0])).join('');
  const stderr = () =>
    (process.stderr.write as unknown as jest.SpyInstance).mock.calls
      .map((c) => String(c[0]))
      .join('');

  it('works as the static Logger backend without recursing', () => {
    Logger.overrideLogger(service);
    expect(() => new Logger('Probe').log('hello password=hunter2')).not.toThrow();
    expect(written()).toContain('password=[REDACTED]');
    expect(written()).not.toContain('hunter2');
  });

  it.each([
    ['JWT_SECRET=my-secret-value', 'JWT_SECRET=[REDACTED]'],
    ['accessToken=eyJhbGciOiJIUzI1NiJ9', 'accessToken=[REDACTED]'],
    ['refreshToken=abc.def', 'refreshToken=[REDACTED]'],
    ['client_secret=s3', 'client_secret=[REDACTED]'],
    ['clientSecret: s3', 'clientSecret: [REDACTED]'],
    ['token=t0', 'token=[REDACTED]'],
    ['authorization: Bearer eyJhbGciOiJIUzI1NiJ9', 'authorization: [REDACTED]'],
    ['{"password":"hunter2"}', '{"password":[REDACTED]}'],
    ['{"refreshToken": "a b c", "x": 1}', '{"refreshToken": [REDACTED], "x": 1}'],
    ['DATABASE_PASSWORD=db-secret', 'DATABASE_PASSWORD=[REDACTED]'],
    [
      'JWT_SECRET=abc123, DATABASE_PASSWORD=def456',
      'JWT_SECRET=[REDACTED], DATABASE_PASSWORD=[REDACTED]',
    ],
  ])('redacts %s', (input, expected) => {
    service.log(input, 'Ctx');
    expect(written()).toContain(expected);
  });

  it('redacts error messages and objects', () => {
    service.error('password=supersecret', 'trace', 'Ctx');
    service.warn({ password: 'hunter2' });
    expect(stderr()).not.toContain('supersecret');
    expect(stderr()).not.toContain('hunter2');
  });

  it('leaves messages without secrets alone', () => {
    service.log('normal log message', 'TestModule');
    expect(written()).toContain('normal log message');
  });
});
