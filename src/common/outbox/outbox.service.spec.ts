import { OutboxConfig, OutboxClock } from './outbox.config';
import { OutboxOperationError } from './outbox.errors';
import { OutboxService } from './outbox.service';
import { SyncOutboxEntity } from './infrastructure/persistence/sync-outbox.entity';

const NOW = new Date('2026-11-26T10:00:00.000Z');
const HOUR = 3_600_000;

const CONFIG: OutboxConfig = {
  pollIntervalSeconds: 5,
  batchSize: 20,
  concurrency: 5,
  maxAttempts: 10_000,
  maxAgeMs: 24 * HOUR,
  baseDelayMs: 1000,
  maxDelayMs: 45_000,
  lockStaleMs: 30_000,
  sentRetentionDays: 7,
};

const raw = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  sequence: '5',
  operation: 'TRANSITION_ISSUE',
  board_id: 'b1',
  card_id: 'c1',
  actor_id: 'u1',
  payload: { targetColumnId: 'done' },
  status: 'IN_PROGRESS',
  attempts: 2,
  available_at: NOW,
  locked_at: NOW,
  locked_by: 'w1',
  last_error: null,
  error_code: null,
  result: null,
  sent_at: null,
  dead_at: null,
  created_at: NOW,
  updated_at: NOW,
  ...over,
});

const entity = (over: Record<string, unknown> = {}) =>
  ({
    id: 'o1',
    attempts: 2,
    createdAt: NOW,
    ...over,
  }) as unknown as SyncOutboxEntity;

const failure = (over: Record<string, unknown> = {}) =>
  ({ status: 'FAILED', retryable: true, errorCode: 'jira_error', error: 'boom', ...over }) as never;

function setup(config: Partial<OutboxConfig> = {}) {
  const query = jest.fn();
  const dataSource = {
    query,
    transaction: jest.fn((work: (m: { query: jest.Mock }) => Promise<unknown>) => work({ query })),
  };
  const clock: OutboxClock = { now: () => NOW };
  const service = new OutboxService(dataSource as never, { ...CONFIG, ...config }, clock);
  return { service, query, dataSource };
}

const uniqueViolation = () => Object.assign(new Error('duplicate'), { code: '23505' });

describe('OutboxService', () => {
  describe('enqueue', () => {
    it('runs the insert on the caller manager and reports an insert or a coalesce', async () => {
      const { service } = setup();
      const manager = { query: jest.fn() };
      manager.query.mockResolvedValueOnce([{ id: 'o1', inserted: true }]);
      manager.query.mockResolvedValueOnce([{ id: 'o1', inserted: false }]);
      const input = {
        operation: 'TRANSITION_ISSUE' as const,
        boardId: 'b1',
        cardId: 'c1',
        actorId: 'u1',
        payload: { targetColumnId: 'done' },
      };
      await expect(service.enqueue(manager as never, input)).resolves.toEqual({
        id: 'o1',
        coalesced: false,
      });
      await expect(service.enqueue(manager as never, input)).resolves.toEqual({
        id: 'o1',
        coalesced: true,
      });
      expect(manager.query.mock.calls[0][1]).toEqual([
        'TRANSITION_ISSUE',
        'b1',
        'c1',
        'u1',
        '{"targetColumnId":"done"}',
        NOW,
        'targetColumnId',
      ]);
    });
  });

  describe('claim', () => {
    it('returns nothing for a non-positive limit without querying', async () => {
      const { service, query } = setup();
      await expect(service.claim('w1', 0)).resolves.toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('maps rows and orders them by sequence', async () => {
      const { service, query } = setup();
      query.mockResolvedValue([raw({ id: 'b', sequence: '9' }), raw({ id: 'a', sequence: '3' })]);
      const rows = await service.claim('w1', 5);
      expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
      expect(rows[0]).toMatchObject({ boardId: 'b1', cardId: 'c1', lockedBy: 'w1' });
      expect(query.mock.calls[0][1]).toEqual([NOW, 5, 'w1']);
    });

    it('yields to the next tick on a unique violation and rethrows other errors', async () => {
      const { service, query } = setup();
      query.mockRejectedValueOnce(uniqueViolation());
      await expect(service.claim('w1', 5)).resolves.toEqual([]);
      query.mockRejectedValueOnce(new Error('db down'));
      await expect(service.claim('w1', 5)).rejects.toThrow('db down');
    });
  });

  describe('complete', () => {
    it('is true while the worker holds the lock and false once it was reclaimed', async () => {
      const { service, query } = setup();
      query.mockResolvedValueOnce([{ id: 'o1' }]).mockResolvedValueOnce([]);
      await expect(service.complete('o1', 'w1', { outcome: 'transitioned' })).resolves.toBe(true);
      expect(query.mock.calls[0][1]).toEqual(['o1', 'w1', NOW, '{"outcome":"transitioned"}']);
      await expect(service.complete('o1', 'w1', null)).resolves.toBe(false);
      expect(query.mock.calls[1][1][3]).toBeNull();
    });
  });

  describe('fail', () => {
    it('retries a transient failure with a jittered delay between the floor and the cap', async () => {
      const { service, query } = setup();
      query.mockResolvedValue([raw({ status: 'PENDING', attempts: 3 })]);
      const result = await service.fail(entity(), 'w1', failure());
      expect(result.outcome).toBe('RETRY');
      const [, , attempts, availableAt] = query.mock.calls[0][1] as [string, string, number, Date];
      expect(attempts).toBe(3);
      const delay = availableAt.getTime() - NOW.getTime();
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(45_000);
    });

    it('clamps a Retry-After delay into the configured range', async () => {
      const { service, query } = setup();
      query.mockResolvedValue([raw({ status: 'PENDING' })]);
      await service.fail(entity(), 'w1', failure({ delayMs: 600_000 }));
      expect((query.mock.calls[0][1][3] as Date).getTime() - NOW.getTime()).toBe(45_000);
    });

    it('reports a newer pending row as SUPERSEDED and a lost lock as LOST', async () => {
      const { service, query } = setup();
      query.mockResolvedValueOnce([raw({ status: 'SENT' })]).mockResolvedValueOnce([]);
      await expect(service.fail(entity(), 'w1', failure())).resolves.toMatchObject({
        outcome: 'SUPERSEDED',
      });
      await expect(service.fail(entity(), 'w1', failure())).resolves.toEqual({ outcome: 'LOST' });
    });

    it('re-runs the retry once after a unique violation, then gives up', async () => {
      const { service, query } = setup();
      query
        .mockRejectedValueOnce(uniqueViolation())
        .mockResolvedValueOnce([raw({ status: 'PENDING' })]);
      await expect(service.fail(entity(), 'w1', failure())).resolves.toMatchObject({
        outcome: 'RETRY',
      });
      query.mockReset();
      query.mockRejectedValue(uniqueViolation());
      await expect(service.fail(entity(), 'w1', failure())).rejects.toThrow('duplicate');
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('dead-letters a permanent failure with its own code', async () => {
      const { service, query } = setup();
      query.mockResolvedValue([raw({ status: 'DEAD', error_code: 'jira_forbidden' })]);
      const result = await service.fail(
        entity(),
        'w1',
        failure({ retryable: false, errorCode: 'jira_forbidden' }),
      );
      expect(result).toMatchObject({ outcome: 'DEAD' });
      expect(query.mock.calls[0][1][3]).toBe('jira_forbidden');
      expect(query.mock.calls[0][1][5]).toBe(3);
    });

    it('dead-letters a retryable failure once the row is older than the retry window', async () => {
      const { service, query } = setup();
      query.mockResolvedValue([raw({ status: 'DEAD' })]);
      const old = entity({ createdAt: new Date(NOW.getTime() - 24 * HOUR) });
      await expect(service.fail(old, 'w1', failure())).resolves.toMatchObject({ outcome: 'DEAD' });
      expect(query.mock.calls[0][1][3]).toBe('attempts_exhausted');
    });

    it('keeps retrying a row that is 23 hours old', async () => {
      const { service, query } = setup();
      query.mockResolvedValue([raw({ status: 'PENDING' })]);
      const young = entity({ createdAt: new Date(NOW.getTime() - 23 * HOUR) });
      await expect(service.fail(young, 'w1', failure())).resolves.toMatchObject({
        outcome: 'RETRY',
      });
    });

    it('dead-letters at the attempts safety cap and reports LOST when the lock was lost', async () => {
      const { service, query } = setup({ maxAttempts: 3 });
      query.mockResolvedValueOnce([raw({ status: 'DEAD' })]).mockResolvedValueOnce([]);
      await expect(service.fail(entity({ attempts: 2 }), 'w1', failure())).resolves.toMatchObject({
        outcome: 'DEAD',
      });
      await expect(service.fail(entity({ attempts: 2 }), 'w1', failure())).resolves.toEqual({
        outcome: 'LOST',
      });
    });

    it('sanitizes the stored error message', async () => {
      const { service, query } = setup();
      query.mockResolvedValue([raw({ status: 'PENDING' })]);
      await service.fail(entity(), 'w1', failure({ error: 'Bearer abcdefghij1234 token=s3cret' }));
      expect(query.mock.calls[0][1][5]).toBe('[redacted] token=[redacted]');
    });
  });

  describe('reclaimStale', () => {
    it('sends stale locks through fail and returns the rows that became DEAD', async () => {
      const { service, query } = setup({ maxAttempts: 3 });
      query
        .mockResolvedValueOnce([
          raw({ id: 's1', attempts: 0 }),
          raw({ id: 's2', attempts: 2 }),
          raw({ id: 's3', locked_by: null }),
        ])
        .mockResolvedValueOnce([raw({ id: 's1', status: 'PENDING' })])
        .mockResolvedValueOnce([raw({ id: 's2', status: 'DEAD' })]);
      const dead = await service.reclaimStale();
      expect(dead.map((r) => r.id)).toEqual(['s2']);
      expect(query.mock.calls[0][1]).toEqual([new Date(NOW.getTime() - 30_000)]);
      expect(query).toHaveBeenCalledTimes(3); // s3 has no lock owner and is skipped
    });
  });

  describe('requeue', () => {
    const found = (over: Record<string, unknown> = {}) => [raw({ status: 'DEAD', ...over })];

    it('refuses an unknown row and a row that is not DEAD', async () => {
      const { service, query } = setup();
      query.mockResolvedValueOnce([]);
      await expect(service.requeue('o1')).rejects.toMatchObject({ refusal: 'not_found' });
      query.mockResolvedValueOnce(found({ status: 'SENT' }));
      await expect(service.requeue('o1')).rejects.toMatchObject({ refusal: 'not_dead' });
    });

    it('refuses a row that an earlier non-SENT row of the card blocks', async () => {
      const { service, query } = setup();
      query.mockResolvedValueOnce(found()).mockResolvedValueOnce([{ id: 'earlier' }]);
      await expect(service.requeue('o1')).rejects.toBeInstanceOf(OutboxOperationError);
    });

    it('resets the row, with a fresh attempts count and retry window', async () => {
      const { service, query } = setup();
      query
        .mockResolvedValueOnce(found())
        .mockResolvedValueOnce([]) // not blocked
        .mockResolvedValueOnce([]) // no later pending row
        .mockResolvedValueOnce([raw({ status: 'PENDING', attempts: 0 })]);
      const row = await service.requeue('o1');
      expect(row).toMatchObject({ status: 'PENDING', attempts: 0 });
      const update = query.mock.calls[3];
      expect(update[0]).toContain('created_at = $4');
      expect(update[1]).toEqual(['o1', '{"targetColumnId":"done"}', 'u1', NOW]);
    });

    it('merges a later pending row into the requeued one and supersedes it', async () => {
      const { service, query } = setup();
      query
        .mockResolvedValueOnce(found())
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          raw({ id: 'later', status: 'PENDING', actor_id: 'u2', payload: { targetColumnId: 'b' } }),
        ])
        .mockResolvedValueOnce([]) // supersede update
        .mockResolvedValueOnce([raw({ status: 'PENDING', payload: { targetColumnId: 'b' } })]);
      const row = await service.requeue('o1');
      expect(row.payload).toEqual({ targetColumnId: 'b' });
      expect(query.mock.calls[3][1][0]).toBe('later');
      expect(query.mock.calls[4][1]).toEqual(['o1', '{"targetColumnId":"b"}', 'u2', NOW]);
    });
  });

  describe('purgeSent', () => {
    it('deletes SENT rows older than the retention and counts them', async () => {
      const { service, query } = setup();
      query.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      await expect(service.purgeSent()).resolves.toBe(2);
      expect(query.mock.calls[0][1]).toEqual([new Date(NOW.getTime() - 7 * 86_400_000)]);
    });
  });
});
