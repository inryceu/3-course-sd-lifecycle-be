import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LatencyRecorder, LatencyReport, summarizeLatencies } from './latency';

describe('summarizeLatencies', () => {
  it('computes count, min, average and max', () => {
    expect(summarizeLatencies([12, 4, 20])).toEqual({
      count: 3,
      min: 4,
      avg: 12,
      max: 20,
    });
  });

  it('rejects an empty sample set', () => {
    expect(() => summarizeLatencies([])).toThrow(/empty/i);
  });

  it('rejects non-finite and negative samples', () => {
    expect(() => summarizeLatencies([1, Number.NaN])).toThrow(/invalid latency/i);
    expect(() => summarizeLatencies([-1])).toThrow(/invalid latency/i);
  });
});

describe('LatencyRecorder', () => {
  let directory: string;
  let resultsPath: string;
  let now: number;
  let recorder: LatencyRecorder;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'boardsync-latency-'));
    resultsPath = join(directory, 'nested', 'latency-jira-sync.json');
    now = 0;
    recorder = new LatencyRecorder({ resultsPath, now: () => now });
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('aggregates samples per label and persists the report', () => {
    recorder.record('move', 10);
    recorder.record('move', 30);
    recorder.record('comment', 5);

    expect(recorder.stats('move')).toEqual({ count: 2, min: 10, avg: 20, max: 30 });
    expect(recorder.stats('comment')).toEqual({ count: 1, min: 5, avg: 5, max: 5 });

    const persisted = JSON.parse(readFileSync(resultsPath, 'utf8')) as LatencyReport;
    expect(persisted.labels).toEqual({
      move: { count: 2, min: 10, avg: 20, max: 30 },
      comment: { count: 1, min: 5, avg: 5, max: 5 },
    });
    expect(Date.parse(persisted.generatedAt)).not.toBeNaN();
  });

  it('measure returns the callback result and records elapsed time', async () => {
    now = 100;
    const result = await recorder.measure('move', () => {
      now = 175;
      return Promise.resolve('moved');
    });

    expect(result).toBe('moved');
    expect(recorder.stats('move')).toEqual({ count: 1, min: 75, avg: 75, max: 75 });
  });

  it('measure records elapsed time when the callback fails', async () => {
    now = 10;
    await expect(
      recorder.measure('move', () => {
        now = 40;
        return Promise.reject(new Error('boom'));
      }),
    ).rejects.toThrow('boom');

    expect(recorder.stats('move')).toEqual({ count: 1, min: 30, avg: 30, max: 30 });
  });

  it('assertWithinBudget passes at the budget and fails above it', () => {
    recorder.record('move', 5_000);
    expect(recorder.assertWithinBudget('move', 5_000).max).toBe(5_000);

    recorder.record('move', 5_001);
    expect(() => recorder.assertWithinBudget('move', 5_000)).toThrow(/budget exceeded/i);
  });

  it('assertWithinBudget rejects labels without samples', () => {
    expect(() => recorder.assertWithinBudget('missing', 5_000)).toThrow(/no latency samples/i);
  });
});
