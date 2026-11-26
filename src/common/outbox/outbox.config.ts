export interface OutboxConfig {
  pollIntervalSeconds: number;
  batchSize: number;
  concurrency: number;
  /** Safety cap on attempts; the age limit below normally dead-letters first. */
  maxAttempts: number;
  /** A row still failing this long after it was queued is dead-lettered (`OUTBOX_MAX_AGE_HOURS`). */
  maxAgeMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  lockStaleMs: number;
  sentRetentionDays: number;
}

export interface OutboxClock {
  now(): Date;
}

export const OUTBOX_CONFIG = 'OUTBOX_CONFIG';
export const OUTBOX_CLOCK = 'OUTBOX_CLOCK';
export const systemClock: OutboxClock = { now: () => new Date() };

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${key} must be an integer >= ${min}`);
  }
  return value;
}

/** Reads OUTBOX_* variables with the defaults from the design; throws on invalid values. */
export function loadOutboxConfig(env: NodeJS.ProcessEnv = process.env): OutboxConfig {
  const config: OutboxConfig = {
    pollIntervalSeconds: readInt(env, 'OUTBOX_POLL_INTERVAL_SECONDS', 5, 0),
    batchSize: readInt(env, 'OUTBOX_BATCH_SIZE', 20, 1),
    concurrency: readInt(env, 'OUTBOX_CONCURRENCY', 5, 1),
    maxAttempts: readInt(env, 'OUTBOX_MAX_ATTEMPTS', 10000, 1),
    maxAgeMs: readInt(env, 'OUTBOX_MAX_AGE_HOURS', 24, 1) * 3_600_000,
    baseDelayMs: readInt(env, 'OUTBOX_BASE_DELAY_MS', 1000, 1),
    maxDelayMs: readInt(env, 'OUTBOX_MAX_DELAY_MS', 45000, 1),
    lockStaleMs: readInt(env, 'OUTBOX_LOCK_STALE_MS', 30000, 1),
    sentRetentionDays: readInt(env, 'OUTBOX_SENT_RETENTION_DAYS', 7, 1),
  };
  if (config.maxDelayMs < config.baseDelayMs) {
    throw new Error('OUTBOX_MAX_DELAY_MS must be >= OUTBOX_BASE_DELAY_MS');
  }
  return config;
}
