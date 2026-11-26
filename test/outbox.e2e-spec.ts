import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/config/database-config';
import { OutboxService } from '../src/common/outbox/outbox.service';
import { loadOutboxConfig, systemClock } from '../src/common/outbox/outbox.config';

interface Row {
  id: string;
  status: string;
  attempts: number;
  card_id: string;
  sequence: string;
  payload: Record<string, unknown>;
  error_code: string | null;
}

describe('Outbox core (e2e)', () => {
  const name = `bs_outbox_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: DataSource;
  let ds: DataSource;
  let service: OutboxService;

  const boardId = randomUUID();

  const insert = async (
    cardId: string,
    operation: string,
    status: string,
    opts: { attempts?: number; payload?: object; lockedAgoMs?: number } = {},
  ): Promise<string> => {
    const rows = await ds.query(
      `INSERT INTO sync_outbox
         (operation, board_id, card_id, payload, status, attempts, available_at, locked_at, locked_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::sync_outbox_status_enum, $6, now() - interval '1 minute',
         CASE WHEN $5 = 'IN_PROGRESS' THEN now() - ($7 || ' milliseconds')::interval ELSE NULL END,
         CASE WHEN $5 = 'IN_PROGRESS' THEN 'dead-worker' ELSE NULL END)
       RETURNING id`,
      [
        operation,
        boardId,
        cardId,
        JSON.stringify(opts.payload ?? { targetColumnId: 'a' }),
        status,
        opts.attempts ?? 0,
        String(opts.lockedAgoMs ?? 0),
      ],
    );
    return rows[0].id;
  };

  const get = async (id: string): Promise<Row> =>
    (await ds.query(`SELECT * FROM sync_outbox WHERE id = $1`, [id]))[0];

  beforeAll(async () => {
    admin = new DataSource({ ...dataSourceOptions, database: 'postgres', logging: false });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    ds = new DataSource({ ...dataSourceOptions, database: name, logging: false });
    await ds.initialize();
    await ds.runMigrations({ transaction: 'each' });
    service = new OutboxService(ds, loadOutboxConfig({}), systemClock);
  });

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin?.destroy();
  });

  beforeEach(async () => {
    await ds.query('TRUNCATE sync_outbox');
  });

  it('coalesces into a PENDING row; a changed target resets attempts', async () => {
    const card = randomUUID();
    const first = await service.enqueue(ds.manager, {
      operation: 'TRANSITION_ISSUE',
      boardId,
      cardId: card,
      payload: { targetColumnId: 'a' },
    });
    expect(first.coalesced).toBe(false);
    await ds.query(`UPDATE sync_outbox SET attempts = 3 WHERE id = $1`, [first.id]);

    const same = await service.enqueue(ds.manager, {
      operation: 'TRANSITION_ISSUE',
      boardId,
      cardId: card,
      payload: { targetColumnId: 'a' },
    });
    expect(same).toEqual({ id: first.id, coalesced: true });
    expect((await get(first.id)).attempts).toBe(3);

    await service.enqueue(ds.manager, {
      operation: 'TRANSITION_ISSUE',
      boardId,
      cardId: card,
      payload: { targetColumnId: 'b' },
    });
    const merged = await get(first.id);
    expect(merged.attempts).toBe(0);
    expect(merged.payload).toEqual({ targetColumnId: 'b' });
  });

  it('does not coalesce into IN_PROGRESS; a new PENDING row is created', async () => {
    const card = randomUUID();
    const busy = await insert(card, 'TRANSITION_ISSUE', 'IN_PROGRESS');
    const res = await service.enqueue(ds.manager, {
      operation: 'TRANSITION_ISSUE',
      boardId,
      cardId: card,
      payload: { targetColumnId: 'b' },
    });
    expect(res.coalesced).toBe(false);
    expect(res.id).not.toBe(busy);
  });

  it('two concurrent claimers never overlap on a card and keep order (200 iterations)', async () => {
    for (let i = 0; i < 200; i++) {
      await ds.query('TRUNCATE sync_outbox');
      const heads = new Map<string, string>();
      for (let c = 0; c < 4; c++) {
        const card = randomUUID();
        heads.set(card, await insert(card, 'TRANSITION_ISSUE', 'PENDING'));
        await insert(card, 'OTHER_OP', 'PENDING');
      }
      const [a, b] = await Promise.all([service.claim('A', 10), service.claim('B', 10)]);
      const claimed = [...a, ...b];
      expect(new Set(claimed.map((r) => r.id)).size).toBe(claimed.length);
      expect(new Set(claimed.map((r) => r.cardId)).size).toBe(claimed.length);
      for (const row of claimed) expect(row.id).toBe(heads.get(row.cardId));

      const dup = await ds.query(
        `SELECT card_id FROM sync_outbox WHERE status = 'IN_PROGRESS'
         GROUP BY card_id HAVING count(*) > 1`,
      );
      expect(dup).toHaveLength(0);
    }
  }, 120_000);

  it('a DEAD head blocks later rows of the same card', async () => {
    const card = randomUUID();
    await insert(card, 'TRANSITION_ISSUE', 'DEAD');
    await insert(card, 'OTHER_OP', 'PENDING');
    expect(await service.claim('A', 10)).toHaveLength(0);
  });

  it('different cards are claimed together', async () => {
    await insert(randomUUID(), 'TRANSITION_ISSUE', 'PENDING');
    await insert(randomUUID(), 'TRANSITION_ISSUE', 'PENDING');
    expect(await service.claim('A', 10)).toHaveLength(2);
  });

  it('reclaims a stale lock back to PENDING with attempts + 1', async () => {
    const id = await insert(randomUUID(), 'TRANSITION_ISSUE', 'IN_PROGRESS', {
      lockedAgoMs: 60_000,
    });
    await service.reclaimStale();
    const row = await get(id);
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(1);
  });

  it('stale row with a newer PENDING row becomes SENT (superseded)', async () => {
    const card = randomUUID();
    const stale = await insert(card, 'TRANSITION_ISSUE', 'IN_PROGRESS', { lockedAgoMs: 60_000 });
    await insert(card, 'TRANSITION_ISSUE', 'PENDING');
    await service.reclaimStale();
    expect((await get(stale)).status).toBe('SENT');
  });

  it('stale row with exhausted attempts becomes DEAD', async () => {
    const id = await insert(randomUUID(), 'TRANSITION_ISSUE', 'IN_PROGRESS', {
      attempts: loadOutboxConfig({}).maxAttempts - 1,
      lockedAgoMs: 60_000,
    });
    const dead = await service.reclaimStale();
    expect(dead).toHaveLength(1);
    const row = await get(id);
    expect(row.status).toBe('DEAD');
    expect(row.error_code).toBe('attempts_exhausted');
  });

  it('a row older than the retry window is dead-lettered on its next failure', async () => {
    const id = await insert(randomUUID(), 'TRANSITION_ISSUE', 'IN_PROGRESS', {
      lockedAgoMs: 60_000,
    });
    await ds.query(
      `UPDATE sync_outbox SET created_at = now() - interval '25 hours' WHERE id = $1`,
      [id],
    );
    const dead = await service.reclaimStale();
    expect(dead).toHaveLength(1);
    expect((await get(id)).error_code).toBe('attempts_exhausted');
  });

  it('requeue merges a later PENDING row into the dead row', async () => {
    const card = randomUUID();
    const dead = await insert(card, 'TRANSITION_ISSUE', 'DEAD', {
      payload: { targetColumnId: 'a' },
    });
    const later = await insert(card, 'TRANSITION_ISSUE', 'PENDING', {
      payload: { targetColumnId: 'b' },
    });
    const requeued = await service.requeue(dead);
    expect(requeued.status).toBe('PENDING');
    expect(requeued.attempts).toBe(0);
    expect(requeued.payload).toEqual({ targetColumnId: 'b' });
    expect((await get(later)).status).toBe('SENT');
  });

  it('requeue is refused for non-DEAD rows and for rows blocked by an earlier DEAD row', async () => {
    const card = randomUUID();
    await insert(card, 'TRANSITION_ISSUE', 'DEAD');
    const second = await insert(card, 'OTHER_OP', 'DEAD');
    await expect(service.requeue(second)).rejects.toMatchObject({ refusal: 'blocked' });

    const pending = await insert(randomUUID(), 'TRANSITION_ISSUE', 'PENDING');
    await expect(service.requeue(pending)).rejects.toMatchObject({ refusal: 'not_dead' });
    await expect(service.requeue(randomUUID())).rejects.toMatchObject({ refusal: 'not_found' });
  });
});
