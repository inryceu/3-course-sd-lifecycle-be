import { hostname } from 'os';
import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { SyncOutboxEntity } from './infrastructure/persistence/sync-outbox.entity';
import { OutboxHandlerResult } from './outbox-handler';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { OUTBOX_CLOCK, OUTBOX_CONFIG, OutboxClock, OutboxConfig } from './outbox.config';
import { OUTBOX_ERROR_CODES, OUTBOX_TIME_BUDGET_MS } from './outbox.constants';
import { OutboxService } from './outbox.service';

export type DeadLetterListener = (row: SyncOutboxEntity) => void | Promise<void>;

const PURGE_EVERY_MS = 60 * 60 * 1000;

@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly deadListeners: DeadLetterListener[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private pumping = false;
  private pumpAgain = false;
  private lastPurge = 0;

  constructor(
    private readonly service: OutboxService,
    private readonly registry: OutboxHandlerRegistry,
    @Inject(OUTBOX_CONFIG) private readonly config: OutboxConfig,
    @Inject(OUTBOX_CLOCK) private readonly clock: OutboxClock,
  ) {}

  /** Subscribe to terminal dead letters (notifications are wired here). */
  onDeadLettered(listener: DeadLetterListener): void {
    this.deadListeners.push(listener);
  }

  onApplicationBootstrap(): void {
    // POLL=0 disables the background loop (tests drive the worker with runOnce/drain).
    if (this.config.pollIntervalSeconds > 0) this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.tick(), this.config.pollIntervalSeconds * 1000);
    this.timer.unref?.();
    void this.tick();
  }

  async stop(graceMs = 5000): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight.size === 0) return;
    await Promise.race([
      Promise.all([...this.inFlight]),
      new Promise((resolve) => setTimeout(resolve, graceMs)),
    ]);
  }

  /** Wake the worker after commit; coalesced, never loses a wakeup while a pump is running. */
  kick(): void {
    if (this.running) void this.pump();
  }

  /** Maintenance tick: reclaim stale locks, occasionally purge, then claim. */
  private async tick(): Promise<void> {
    try {
      await this.reclaim();
      const now = this.clock.now().getTime();
      if (now - this.lastPurge > PURGE_EVERY_MS) {
        this.lastPurge = now;
        await this.service.purgeSent();
      }
    } catch (error) {
      this.logger.error(
        'Outbox maintenance failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
    await this.pump();
  }

  private async reclaim(): Promise<void> {
    const dead = await this.service.reclaimStale();
    for (const row of dead) await this.emitDead(row);
  }

  /** Fills every free concurrency slot; a finished handler re-pumps, so slots refill at once. */
  private async pump(): Promise<void> {
    if (!this.running) return;
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        const free = this.config.concurrency - this.inFlight.size;
        if (free <= 0) break;
        const rows = await this.service.claim(this.workerId, Math.min(this.config.batchSize, free));
        for (const row of rows) this.start1(row);
        if (rows.length > 0) this.pumpAgain = true;
      } while (this.pumpAgain && this.running);
    } catch (error) {
      this.logger.error(
        'Outbox claim failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.pumping = false;
    }
  }

  private start1(row: SyncOutboxEntity): void {
    const p: Promise<void> = this.process(row)
      .catch((error) =>
        this.logger.error(
          `Outbox row ${row.id} processing failed`,
          error instanceof Error ? error.stack : String(error),
        ),
      )
      .finally(() => {
        this.inFlight.delete(p);
        void this.pump();
      });
    this.inFlight.add(p);
  }

  /** Test/drain helper: one maintenance + claim round, awaiting every started handler. */
  async runOnce(): Promise<number> {
    await this.reclaim();
    const free = this.config.concurrency - this.inFlight.size;
    const rows = await this.service.claim(this.workerId, Math.min(this.config.batchSize, free));
    await Promise.all(rows.map((row) => this.process(row)));
    return rows.length;
  }

  /** Runs rounds until nothing is claimable right now. */
  async drain(maxRounds = 1000): Promise<void> {
    for (let i = 0; i < maxRounds; i++) {
      if ((await this.runOnce()) === 0) return;
    }
  }

  private async process(row: SyncOutboxEntity): Promise<void> {
    const outcome = await this.execute(row);
    if (outcome.status === 'SENT') {
      const ok = await this.service.complete(row.id, this.workerId, outcome.result ?? null);
      if (!ok) this.logger.warn(`Row ${row.id} finished after its lock was reclaimed`);
      return;
    }
    const result = await this.service.fail(row, this.workerId, outcome);
    if (result.outcome === 'DEAD' && result.row) await this.emitDead(result.row);
  }

  private async execute(row: SyncOutboxEntity): Promise<OutboxHandlerResult> {
    const handler = this.registry.get(row.operation);
    if (!handler) {
      return {
        status: 'FAILED',
        retryable: false,
        errorCode: OUTBOX_ERROR_CODES.handlerMissing,
        error: `No handler registered for operation ${row.operation}`,
      };
    }
    const start = this.clock.now().getTime();
    try {
      return await handler.handle(row, {
        attempt: row.attempts + 1,
        timeBudgetMs: OUTBOX_TIME_BUDGET_MS,
        deadline: start + OUTBOX_TIME_BUDGET_MS,
      });
    } catch (error) {
      return {
        status: 'FAILED',
        retryable: true,
        errorCode: OUTBOX_ERROR_CODES.handlerError,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async emitDead(row: SyncOutboxEntity): Promise<void> {
    for (const listener of this.deadListeners) {
      try {
        await listener(row);
      } catch (error) {
        this.logger.warn(`Dead-letter listener failed for ${row.id}: ${String(error)}`);
      }
    }
  }
}
