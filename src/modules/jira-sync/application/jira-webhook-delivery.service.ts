import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JiraWebhookDeliveryEntity } from '../infrastructure/persistence/jira-webhook-delivery.entity';

export const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DELIVERY_CLAIM_STALE_MS = 5 * 60 * 1000;

@Injectable()
export class JiraWebhookDeliveryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Expired rows are removed by the lifecycle sweep, not on every claim. */
  async claim(deliveryKey: string, now = new Date()): Promise<boolean> {
    const expiresAt = new Date(now.getTime() + DELIVERY_RETENTION_MS);

    const inserted = await this.dataSource.query<JiraWebhookDeliveryEntity[]>(
      `INSERT INTO jira_webhook_deliveries
         (delivery_key, status, attempts, claimed_at, expires_at)
       VALUES ($1, 'processing', 1, $2, $3)
       ON CONFLICT (delivery_key) DO NOTHING
       RETURNING delivery_key`,
      [deliveryKey, now, expiresAt],
    );
    if (inserted.length > 0) return true;

    const staleBefore = new Date(now.getTime() - DELIVERY_CLAIM_STALE_MS);
    // Wrapped in a CTE: TypeORM returns `[rows, rowCount]` for a bare UPDATE, whose length is
    // always 2, which made every duplicate look reclaimed.
    const reclaimed = await this.dataSource.query<JiraWebhookDeliveryEntity[]>(
      `WITH reclaimed AS (
       UPDATE jira_webhook_deliveries
          SET status = 'processing',
              attempts = attempts + 1,
              claimed_at = $2,
              expires_at = $3,
              "updatedAt" = now()
        WHERE delivery_key = $1
          AND status = 'processing'
          AND claimed_at < $4
        RETURNING delivery_key
       )
       SELECT delivery_key FROM reclaimed`,
      [deliveryKey, now, expiresAt, staleBefore],
    );
    return reclaimed.length > 0;
  }

  async complete(deliveryKey: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE jira_webhook_deliveries
          SET status = 'processed', "updatedAt" = now()
        WHERE delivery_key = $1`,
      [deliveryKey],
    );
  }

  async release(deliveryKey: string): Promise<void> {
    await this.dataSource.query('DELETE FROM jira_webhook_deliveries WHERE delivery_key = $1', [
      deliveryKey,
    ]);
  }

  async deleteExpired(now = new Date()): Promise<void> {
    await this.dataSource.query('DELETE FROM jira_webhook_deliveries WHERE expires_at <= $1', [
      now,
    ]);
  }
}
