/** Retry timing policy taken from the validated `outbox` configuration. */
export interface BackoffPolicy {
  /** Floor of every delay (`OUTBOX_BASE_DELAY_MS`). */
  baseDelayMs: number;
  /** Hard ceiling of every delay (`OUTBOX_MAX_DELAY_MS`). */
  maxDelayMs: number;
}

/**
 * Full-jitter delay for a retryable failure of attempt `n` (1-based):
 *
 * ```
 * cap_n    = min(maxDelayMs, baseDelayMs * 2^(n-1))
 * delay    = random_between(baseDelayMs, cap_n)
 * ```
 *
 * The result always satisfies `baseDelayMs <= delay <= maxDelayMs`, so a slow exponential
 * growth can never exceed the configured cap. `random` is injectable for deterministic tests.
 */
export function backoffDelayMs(
  attempt: number,
  policy: BackoffPolicy,
  random: () => number = Math.random,
): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1;
  const exponent = Math.min(n - 1, 52);
  const lower = Math.min(policy.baseDelayMs, policy.maxDelayMs);
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
  const upper = Math.max(lower, cap);
  const span = upper - lower;
  if (span <= 0) return lower;
  const sample = Math.min(Math.max(random(), 0), 0.9999999999999999);
  return lower + Math.floor(sample * (span + 1));
}

/**
 * Clamps a provider supplied delay (429 `Retry-After`) into `[baseDelayMs, maxDelayMs]`.
 * Non-finite or negative values fall back to the floor.
 */
export function clampDelayMs(valueMs: number, policy: BackoffPolicy): number {
  const lower = Math.min(policy.baseDelayMs, policy.maxDelayMs);
  const upper = Math.max(policy.baseDelayMs, policy.maxDelayMs);
  if (!Number.isFinite(valueMs)) return lower;
  return Math.min(Math.max(Math.round(valueMs), lower), upper);
}
