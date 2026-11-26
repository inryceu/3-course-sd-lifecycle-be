import { loadOutboxConfig, systemClock } from './outbox.config';

describe('loadOutboxConfig', () => {
  it('defaults: 1 s to 45 s backoff, 24 h retry window, 5 s poll', () => {
    expect(loadOutboxConfig({})).toEqual({
      pollIntervalSeconds: 5,
      batchSize: 20,
      concurrency: 5,
      maxAttempts: 10_000,
      maxAgeMs: 24 * 3_600_000,
      baseDelayMs: 1000,
      maxDelayMs: 45_000,
      lockStaleMs: 30_000,
      sentRetentionDays: 7,
    });
  });

  it('reads overrides, treating an empty value as unset', () => {
    const config = loadOutboxConfig({
      OUTBOX_MAX_AGE_HOURS: '48',
      OUTBOX_MAX_DELAY_MS: '300000',
      OUTBOX_POLL_INTERVAL_SECONDS: '0',
      OUTBOX_BATCH_SIZE: '',
    });
    expect(config).toMatchObject({
      maxAgeMs: 48 * 3_600_000,
      maxDelayMs: 300_000,
      pollIntervalSeconds: 0,
      batchSize: 20,
    });
  });

  it.each([
    ['OUTBOX_BATCH_SIZE', '0'],
    ['OUTBOX_MAX_AGE_HOURS', '1.5'],
    ['OUTBOX_CONCURRENCY', 'many'],
    ['OUTBOX_POLL_INTERVAL_SECONDS', '-1'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => loadOutboxConfig({ [key]: value })).toThrow(key);
  });

  it('rejects a cap below the base delay', () => {
    expect(() =>
      loadOutboxConfig({ OUTBOX_BASE_DELAY_MS: '5000', OUTBOX_MAX_DELAY_MS: '1000' }),
    ).toThrow('OUTBOX_MAX_DELAY_MS');
  });

  it('the system clock returns the current time', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
