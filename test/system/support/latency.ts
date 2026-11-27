import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

export const DEFAULT_LATENCY_BUDGET_MS = 5_000;

export const DEFAULT_LATENCY_RESULTS_PATH = resolve(
  __dirname,
  '../../../test-results/latency-jira-sync.json',
);

export interface LatencyStats {
  count: number;
  min: number;
  avg: number;
  max: number;
}

export interface LatencyReport {
  generatedAt: string;
  labels: Record<string, LatencyStats>;
}

export interface LatencyRecorderOptions {
  resultsPath?: string;
  now?: () => number;
}

export function summarizeLatencies(samples: readonly number[]): LatencyStats {
  if (samples.length === 0) {
    throw new Error('Cannot summarize an empty latency sample set');
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;

  for (const sample of samples) {
    assertValidSample(sample);
    min = Math.min(min, sample);
    max = Math.max(max, sample);
    total += sample;
  }

  return { count: samples.length, min, avg: total / samples.length, max };
}

export class LatencyRecorder {
  private readonly samples = new Map<string, number[]>();
  private readonly resultsPath: string;
  private readonly now: () => number;

  constructor(options: LatencyRecorderOptions = {}) {
    this.resultsPath = options.resultsPath ?? DEFAULT_LATENCY_RESULTS_PATH;
    this.now = options.now ?? (() => performance.now());
  }

  record(label: string, ms: number): void {
    assertValidLabel(label);
    assertValidSample(ms);

    const samples = this.samples.get(label);
    if (samples === undefined) {
      this.samples.set(label, [ms]);
    } else {
      samples.push(ms);
    }

    this.flush();
  }

  async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    assertValidLabel(label);

    const start = this.now();
    try {
      return await fn();
    } finally {
      this.record(label, this.now() - start);
    }
  }

  stats(label: string): LatencyStats | undefined {
    const samples = this.samples.get(label);
    return samples === undefined ? undefined : summarizeLatencies(samples);
  }

  report(): LatencyReport {
    const labels: Record<string, LatencyStats> = {};
    for (const [label, samples] of this.samples) {
      labels[label] = summarizeLatencies(samples);
    }
    return { generatedAt: new Date().toISOString(), labels };
  }

  assertWithinBudget(label: string, budgetMs: number = DEFAULT_LATENCY_BUDGET_MS): LatencyStats {
    if (!Number.isFinite(budgetMs) || budgetMs < 0) {
      throw new Error(`Invalid latency budget: ${budgetMs}`);
    }

    const stats = this.stats(label);
    if (stats === undefined) {
      throw new Error(`No latency samples recorded for "${label}"`);
    }

    if (stats.max > budgetMs) {
      throw new Error(
        `Latency budget exceeded for "${label}": max ${stats.max.toFixed(2)} ms > ${budgetMs} ms (count=${stats.count}, avg=${stats.avg.toFixed(2)} ms)`,
      );
    }

    return stats;
  }

  flush(): void {
    mkdirSync(dirname(this.resultsPath), { recursive: true });
    writeFileSync(this.resultsPath, `${JSON.stringify(this.report(), null, 2)}\n`, 'utf8');
  }

  reset(): void {
    this.samples.clear();
  }
}

const defaultRecorder = new LatencyRecorder();

export function measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return defaultRecorder.measure(label, fn);
}

export function record(label: string, ms: number): void {
  defaultRecorder.record(label, ms);
}

export function assertWithinBudget(
  label: string,
  budgetMs: number = DEFAULT_LATENCY_BUDGET_MS,
): LatencyStats {
  return defaultRecorder.assertWithinBudget(label, budgetMs);
}

function assertValidLabel(label: string): void {
  if (label.trim().length === 0) {
    throw new Error('Latency label must not be empty');
  }
}

function assertValidSample(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Invalid latency sample: ${ms}`);
  }
}
