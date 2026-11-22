import { backoffDelayMs, clampDelayMs } from './outbox-backoff';

const policy = { baseDelayMs: 1000, maxDelayMs: 30000 };

describe('backoffDelayMs', () => {
  it('stays within [base, min(cap, base * 2^(n-1))] for every attempt and random value', () => {
    for (let n = 1; n <= 60; n++) {
      for (const r of [0, 0.25, 0.5, 0.999999, 1]) {
        const delay = backoffDelayMs(n, policy, () => r);
        const upper = Math.min(30000, 1000 * 2 ** (n - 1));
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(upper);
      }
    }
  });

  it('never exceeds the cap even for absurd attempt numbers', () => {
    for (const n of [100, 1000, Number.MAX_SAFE_INTEGER, NaN, -5]) {
      expect(backoffDelayMs(n, policy, () => 1)).toBeLessThanOrEqual(30000);
    }
  });

  it('first attempt is always the floor', () => {
    expect(backoffDelayMs(1, policy, () => 0.7)).toBe(1000);
  });
});

describe('clampDelayMs', () => {
  it('clamps Retry-After into [base, max]', () => {
    expect(clampDelayMs(45_000, policy)).toBe(30000);
    expect(clampDelayMs(10, policy)).toBe(1000);
    expect(clampDelayMs(5000, policy)).toBe(5000);
    expect(clampDelayMs(NaN, policy)).toBe(1000);
  });
});
