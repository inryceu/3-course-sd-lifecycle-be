import { DataSource } from 'typeorm';
import {
  DELIVERY_CLAIM_STALE_MS,
  DELIVERY_RETENTION_MS,
  JiraWebhookDeliveryService,
} from './jira-webhook-delivery.service';

function setup() {
  const query = jest.fn().mockResolvedValue([]);
  const dataSource = { query } as unknown as DataSource;
  return { service: new JiraWebhookDeliveryService(dataSource), query };
}

describe('JiraWebhookDeliveryService', () => {
  it('claims a new delivery and stores a seven-day expiry', async () => {
    const { service, query } = setup();
    const now = new Date('2026-11-05T10:00:00Z');
    query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('INSERT INTO') ? [{ delivery_key: 'k1' }] : []),
    );

    await expect(service.claim('k1', now)).resolves.toBe(true);

    const insert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO'));
    expect(insert?.[1]).toEqual(['k1', now, new Date(now.getTime() + DELIVERY_RETENTION_MS)]);
  });

  it('reports a duplicate when an unexpired processed row exists', async () => {
    const { service, query } = setup();
    query.mockResolvedValue([]);

    await expect(service.claim('k1')).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reclaims a processing row older than five minutes', async () => {
    const { service, query } = setup();
    const now = new Date('2026-11-05T10:00:00Z');
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO')) return Promise.resolve([]);
      if (sql.includes('UPDATE jira_webhook_deliveries'))
        return Promise.resolve([{ delivery_key: 'k1' }]);
      return Promise.resolve([]);
    });

    await expect(service.claim('k1', now)).resolves.toBe(true);

    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE jira_webhook_deliveries'),
    );
    expect(update?.[1]).toEqual([
      'k1',
      now,
      new Date(now.getTime() + DELIVERY_RETENTION_MS),
      new Date(now.getTime() - DELIVERY_CLAIM_STALE_MS),
    ]);
    expect(update?.[0]).toContain("status = 'processing'");
    expect(update?.[0]).toContain('attempts = attempts + 1');
  });

  it('does not run the retention cleanup on every claim', async () => {
    const { service, query } = setup();

    await service.claim('k1');

    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM jira_webhook_deliveries'),
      expect.anything(),
    );
  });

  it('marks a claimed delivery as processed', async () => {
    const { service, query } = setup();

    await service.complete('k1');

    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'processed'"), ['k1']);
  });

  it('releases a failed delivery', async () => {
    const { service, query } = setup();

    await service.release('k1');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM jira_webhook_deliveries'),
      ['k1'],
    );
  });

  it('deletes expired rows using the supplied clock', async () => {
    const { service, query } = setup();
    const now = new Date('2026-11-05T10:00:00Z');

    await service.deleteExpired(now);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('expires_at <= $1'), [now]);
  });

  it('allows exactly one of two concurrent claims', async () => {
    const { service, query } = setup();
    let inserted = false;
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO')) {
        if (inserted) return Promise.resolve([]);
        inserted = true;
        return Promise.resolve([{ delivery_key: 'k1' }]);
      }
      return Promise.resolve([]);
    });

    const results = await Promise.all([service.claim('k1'), service.claim('k1')]);

    expect(results.sort()).toEqual([false, true]);
  });
});
