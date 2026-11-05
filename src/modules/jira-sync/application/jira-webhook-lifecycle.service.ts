import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BOARDS_FACADE, BoardsFacade } from '../../boards';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraWebhookEntity } from '../infrastructure/persistence/jira-webhook.entity';
import { JIRA_GATEWAY, JiraGateway } from './jira-gateway.port';
import { JiraWebhookDeliveryService } from './jira-webhook-delivery.service';

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WEBHOOK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_LOCK_ID = 742_026_001;
const WEBHOOK_EVENTS = ['jira:issue_updated'];

export interface SweepResult {
  readonly acquired: boolean;
  readonly refreshed: number;
  readonly replaced: number;
  readonly registered: number;
}

interface RegisterOptions {
  readonly force?: boolean;
  readonly now?: Date;
}

@Injectable()
export class JiraWebhookLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JiraWebhookLifecycleService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(JiraWebhookEntity)
    private readonly webhooks: Repository<JiraWebhookEntity>,
    @InjectRepository(JiraConnectionEntity)
    private readonly connections: Repository<JiraConnectionEntity>,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
    @Inject(JIRA_GATEWAY) private readonly gateway: JiraGateway,
    private readonly deliveries: JiraWebhookDeliveryService,
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('app.nodeEnv') === 'test') return;
    this.timer = setInterval(() => {
      void this.sweep().catch((error: unknown) => this.logFailure('sweep', error));
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
    void this.sweep().catch((error: unknown) => this.logFailure('sweep', error));
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async registerForBoard(boardId: string, options: RegisterOptions = {}): Promise<boolean> {
    const now = options.now ?? new Date();
    try {
      const url = this.config.get<string>('jira.webhookUrl');
      if (!url) {
        this.logger.warn(`board=${boardId} outcome=registration-skipped reason=webhook-url-unset`);
        return false;
      }
      const board = await this.boards.getBoardSummary(boardId);
      if (!board?.jiraProjectKey) return false;
      if (!(await this.connections.exist({ where: { boardId } }))) return false;

      const existing = await this.webhooks.findOne({ where: { boardId } });
      if (
        existing &&
        !options.force &&
        existing.projectKey === board.jiraProjectKey &&
        existing.url === url
      ) {
        return false;
      }

      const jqlFilter = `project = "${board.jiraProjectKey}"`;
      const result = await this.gateway.registerWebhook({
        boardId,
        url,
        webhooks: [{ events: WEBHOOK_EVENTS, jqlFilter }],
      });
      const outcome = result.webhookRegistrationResult[0];
      if (!outcome || !('createdWebhookId' in outcome)) {
        const errors =
          outcome && 'errors' in outcome ? outcome.errors.join(', ') : 'no registration result';
        this.logger.warn(`board=${boardId} outcome=registration-failed reason=${errors}`);
        return false;
      }

      const expiresAt = await this.findExpiration(boardId, outcome.createdWebhookId, now);
      await this.webhooks.upsert(
        {
          boardId,
          projectKey: board.jiraProjectKey,
          webhookId: outcome.createdWebhookId,
          url,
          events: WEBHOOK_EVENTS,
          jqlFilter,
          expiresAt,
          lastRefreshedAt: null,
        },
        ['boardId'],
      );
      this.logger.log(`board=${boardId} outcome=registered webhook=${outcome.createdWebhookId}`);
      return true;
    } catch (error) {
      this.logFailure(`board=${boardId} registration`, error);
      return false;
    }
  }

  async removeForBoard(boardId: string): Promise<void> {
    await this.webhooks.delete({ boardId });
  }

  async sweep(now = new Date()): Promise<SweepResult> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const locked = (await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        SWEEP_LOCK_ID,
      ])) as Array<{ locked: boolean }>;
      if (!locked[0]?.locked) {
        return { acquired: false, refreshed: 0, replaced: 0, registered: 0 };
      }

      try {
        return await this.runSweep(now);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_ID]);
      }
    } finally {
      await runner.release();
    }
  }

  private async runSweep(now: Date): Promise<SweepResult> {
    await this.deliveries.deleteExpired(now).catch((error: unknown) => {
      this.logFailure('delivery-cleanup', error);
    });

    let refreshed = 0;
    let replaced = 0;
    let registered = 0;
    const rows = await this.webhooks.find();
    const graceBoundary = monthsBefore(now, 3);

    for (const row of rows) {
      if (row.expiresAt.getTime() > now.getTime() + REFRESH_WINDOW_MS) continue;
      if (row.expiresAt.getTime() < graceBoundary.getTime()) {
        if (await this.registerForBoard(row.boardId, { force: true, now })) {
          replaced += 1;
        }
        continue;
      }

      try {
        const result = await this.gateway.refreshWebhooks({
          boardId: row.boardId,
          webhookIds: [row.webhookId],
        });
        const expiration = validDate(result.expirationDate);
        await this.webhooks.update(
          { id: row.id },
          {
            expiresAt: expiration ?? new Date(now.getTime() + WEBHOOK_LIFETIME_MS),
            lastRefreshedAt: now,
          },
        );
        refreshed += 1;
      } catch (error) {
        this.logFailure(`board=${row.boardId} refresh`, error);
      }
    }

    const connections = await this.connections.find({ select: { boardId: true } });
    for (const connection of connections) {
      const board = await this.boards.getBoardSummary(connection.boardId);
      if (!board?.jiraProjectKey) continue;
      const existing = await this.webhooks.findOne({ where: { boardId: connection.boardId } });
      if (existing?.projectKey === board.jiraProjectKey) continue;
      if (await this.registerForBoard(connection.boardId, { now })) {
        registered += 1;
      }
    }

    this.logger.log(
      `outcome=sweep refreshed=${refreshed} replaced=${replaced} registered=${registered}`,
    );
    return { acquired: true, refreshed, replaced, registered };
  }

  private async findExpiration(boardId: string, webhookId: number, now: Date): Promise<Date> {
    try {
      const list = await this.gateway.listWebhooks({ boardId, maxResults: 100 });
      const found = list.values.find((webhook) => webhook.id === webhookId);
      const expiration = found ? validDate(found.expirationDate) : null;
      if (expiration) return expiration;
    } catch (error) {
      this.logFailure(`board=${boardId} expiration-lookup`, error);
    }
    return new Date(now.getTime() + WEBHOOK_LIFETIME_MS);
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.warn(
      `${operation} outcome=failed error=${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
}

function monthsBefore(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
