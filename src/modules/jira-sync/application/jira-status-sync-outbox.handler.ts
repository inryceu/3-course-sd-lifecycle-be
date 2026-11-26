import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncOutboxEntity } from '../../../common/outbox/infrastructure/persistence/sync-outbox.entity';
import {
  OutboxAttemptContext,
  OutboxHandler,
  OutboxHandlerResult,
} from '../../../common/outbox/outbox-handler';
import { OutboxHandlerRegistry } from '../../../common/outbox/outbox-handler.registry';
import { BOARDS_FACADE, BoardsFacade } from '../../boards';
import { JiraClientError, JiraTimeoutError } from '../domain/jira-gateway.errors';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../infrastructure/persistence/sync-log.entity';
import { JIRA_GATEWAY, JiraGateway, JiraTransition } from './jira-gateway.port';
import { JiraStatusMappingService, LinkedBoard } from './jira-status-mapping.service';
import { DetectedConflict, JiraSyncConflictDetector } from './jira-sync-conflict.detector';

const MIN_CALL_BUDGET_MS = 250;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}-\d+$/;

interface TransitionPayload {
  cardId: string;
  jiraIssueKey: string;
  fromColumnId: string;
  targetColumnId: string;
  /** ISO time of the user's move (the outbox row is written in the move's transaction). */
  occurredAt?: string;
}

/** A failure that must not be retried. */
class PermanentFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Retryable failure with a stable code; `outcome: 'unknown'` when the POST was sent and aborted. */
class TransientFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome?: 'unknown',
  ) {
    super(message);
  }
}

/** TRANSITION_ISSUE: applies one direct Jira transition for a card move (one attempt). */
@Injectable()
export class JiraStatusSyncOutboxHandler implements OutboxHandler, OnModuleInit {
  readonly operation = 'TRANSITION_ISSUE' as const;
  private readonly logger = new Logger(JiraStatusSyncOutboxHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly statusMappings: JiraStatusMappingService,
    @Inject(JIRA_GATEWAY) private readonly gateway: JiraGateway,
    @InjectRepository(SyncLogEntity) private readonly logs: Repository<SyncLogEntity>,
    @InjectRepository(JiraIssueMappingEntity)
    private readonly links: Repository<JiraIssueMappingEntity>,
    private readonly conflicts: JiraSyncConflictDetector,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(row: SyncOutboxEntity, ctx: OutboxAttemptContext): Promise<OutboxHandlerResult> {
    const startedAt = Date.now();
    const p = row.payload as unknown as TransitionPayload;
    let result: OutboxHandlerResult;
    let unknownOutcome = false;
    try {
      result = await this.run(row, ctx, p);
    } catch (error) {
      result = this.classify(error);
      unknownOutcome = error instanceof TransientFailure && error.outcome === 'unknown';
      if (unknownOutcome) {
        this.logger.error(
          `Jira transition for ${p?.jiraIssueKey} on board ${row.boardId}: outcome unknown, will re-read the status before retrying`,
        );
      }
    }

    const details: Record<string, unknown> =
      result.status === 'SENT'
        ? { ...(result.result ?? {}) }
        : {
            errorCode: result.errorCode,
            retryable: result.retryable,
            ...(unknownOutcome ? { outcome: 'unknown' } : {}),
          };
    try {
      const link = await this.links.findOne({
        where: { boardId: row.boardId, jiraIssueKey: p.jiraIssueKey },
        select: { id: true },
      });
      await this.logs.save({
        direction: SyncDirection.TO_JIRA,
        status: this.logStatus(result),
        payload: {
          outboxId: row.id,
          attempt: ctx.attempt,
          cardId: p.cardId,
          issueKey: p.jiraIssueKey,
          fromColumnId: p.fromColumnId,
          toColumnId: p.targetColumnId,
          ...details,
          latencyMs: Date.now() - startedAt,
        },
        errorMessage: result.status === 'SENT' ? null : result.error,
        mappingId: link?.id ?? null,
      });
    } catch (error) {
      this.logger.warn(`Could not write sync log for outbox ${row.id}: ${String(error)}`);
    }
    return result;
  }

  private async run(
    row: SyncOutboxEntity,
    ctx: OutboxAttemptContext,
    p: TransitionPayload,
  ): Promise<OutboxHandlerResult> {
    if (!p?.jiraIssueKey || !p.targetColumnId || !ISSUE_KEY_PATTERN.test(p.jiraIssueKey)) {
      throw new PermanentFailure('invalid_payload', 'Invalid outbox payload or issue key');
    }
    const boardId = row.boardId;
    const linked = await this.resolveLinkedBoard(boardId);
    const link = await this.links.findOne({
      where: { boardId, jiraIssueKey: p.jiraIssueKey },
      select: { id: true },
    });
    const ref = link && {
      linkId: link.id,
      boardId,
      cardId: p.cardId,
      issueKey: p.jiraIssueKey,
    };
    const move = {
      columnId: p.targetColumnId,
      at: new Date(p.occurredAt ?? row.createdAt ?? Date.now()),
    };
    // KAN-45: record the move for the inbound side, then let a Jira change that overtook it win.
    if (ref) {
      const lost =
        (await this.conflicts.noteBoardMove(ref, move)) ??
        (await this.conflicts.overtakenBy(ref, move));
      if (lost) return this.jiraWins(lost);
    }

    const issue = await this.gateway.getIssue({
      boardId,
      issueIdOrKey: p.jiraIssueKey,
      timeBudgetMs: this.budget(ctx),
    });
    const [current] = await this.statusMappings.resolveMappings(linked, [issue.status]);
    if (current.columnId === p.targetColumnId) {
      return { status: 'SENT', result: { outcome: 'no-op', targetStatusId: issue.status.id } };
    }

    const listed = await this.gateway.listTransitions({
      boardId,
      issueIdOrKey: p.jiraIssueKey,
      includeUnavailableTransitions: false,
      timeBudgetMs: this.budget(ctx),
    });
    const unique = new Map(listed.transitions.map((t) => [t.to.id, t.to]));
    const mappings = await this.statusMappings.resolveMappings(linked, [...unique.values()]);
    const byStatus = new Map(mappings.map((m) => [m.jiraStatusId, m]));
    const candidates = listed.transitions
      .filter((t) => t.isAvailable)
      .map((t) => ({ transition: t, mapping: byStatus.get(t.to.id) }))
      .filter((c) => c.mapping !== undefined && c.mapping.columnId === p.targetColumnId)
      .sort((a, b) => this.compare(a.transition, a.mapping, b.transition, b.mapping));

    if (candidates.length === 0) {
      throw new PermanentFailure(
        'no_transition_path',
        `No available transition targets column ${p.targetColumnId}`,
      );
    }

    const chosen = candidates[0].transition;
    // A Jira change may have landed while this move waited in the queue or the attempt ran.
    const overtaken = ref && (await this.conflicts.overtakenBy(ref, move));
    if (overtaken) return this.jiraWins(overtaken);
    try {
      await this.gateway.doTransition({
        boardId,
        issueIdOrKey: p.jiraIssueKey,
        transitionId: chosen.id,
        timeBudgetMs: this.budget(ctx),
      });
    } catch (error) {
      if (error instanceof JiraTimeoutError) {
        // Outcome unknown: the next attempt re-reads the status and no-ops if it landed.
        throw new TransientFailure('deadline_exceeded', error.message, 'unknown');
      }
      if (error instanceof JiraClientError && (error.status === 400 || error.status === 409)) {
        const reread = await this.gateway.getIssue({
          boardId,
          issueIdOrKey: p.jiraIssueKey,
          timeBudgetMs: this.budget(ctx),
        });
        if (reread.status.id !== issue.status.id) {
          throw new TransientFailure('status_changed', 'Issue status changed during transition');
        }
        throw new PermanentFailure('transition_rejected', error.message);
      }
      throw error;
    }
    return {
      status: 'SENT',
      result: {
        outcome: 'transitioned',
        transitionId: chosen.id,
        targetStatusId: chosen.to.id,
        targetStatusName: chosen.to.name,
      },
    };
  }

  /** Jira wins: the move is dropped, the card goes back to Jira's column, the conflict is logged. */
  private async jiraWins(lost: DetectedConflict): Promise<OutboxHandlerResult> {
    await this.boards.moveCardFromExternal({
      boardId: lost.boardId,
      jiraIssueKey: lost.issueKey,
      columnId: lost.jira.columnId,
    });
    await this.conflicts.record(lost);
    return {
      status: 'SENT',
      result: {
        outcome: 'conflict',
        jiraColumnId: lost.jira.columnId,
        jiraStatusName: lost.jira.statusName,
      },
    };
  }

  private logStatus(result: OutboxHandlerResult): SyncStatus {
    if (result.status === 'FAILED') return SyncStatus.FAILED;
    return result.result?.outcome === 'conflict' ? SyncStatus.CONFLICT : SyncStatus.SUCCESS;
  }

  private async resolveLinkedBoard(boardId: string): Promise<LinkedBoard> {
    try {
      return await this.statusMappings.requireLinkedBoard(boardId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw new PermanentFailure('board_not_linked', error.message);
      }
      throw error;
    }
  }

  private budget(ctx: OutboxAttemptContext): number {
    const remaining = Math.min(ctx.deadline - Date.now(), ctx.timeBudgetMs);
    if (remaining < MIN_CALL_BUDGET_MS) {
      throw new TransientFailure('deadline_exceeded', 'Attempt time budget exhausted');
    }
    return remaining;
  }

  private compare(
    lt: JiraTransition,
    lm: { isDefault: boolean; jiraStatusId: string },
    rt: JiraTransition,
    rm: { isDefault: boolean; jiraStatusId: string },
  ): number {
    if (lm.isDefault !== rm.isDefault) return lm.isDefault ? 1 : -1;
    return this.ids(lm.jiraStatusId, rm.jiraStatusId) || this.ids(lt.id, rt.id);
  }

  private ids(l: string, r: string): number {
    return /^\d+$/.test(l) && /^\d+$/.test(r) ? Number(l) - Number(r) : l.localeCompare(r);
  }

  private classify(error: unknown): OutboxHandlerResult {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof PermanentFailure) {
      return { status: 'FAILED', retryable: false, errorCode: error.code, error: message };
    }
    if (error instanceof TransientFailure) {
      return { status: 'FAILED', retryable: true, errorCode: error.code, error: message };
    }
    if (error instanceof JiraClientError) {
      const permanent: Record<number, string> = {
        401: 'jira_unauthorized',
        403: 'jira_forbidden',
        404: 'jira_not_found',
      };
      if (error.status === 429) {
        return { status: 'FAILED', retryable: true, errorCode: 'rate_limited', error: message };
      }
      return {
        status: 'FAILED',
        retryable: false,
        errorCode: permanent[error.status] ?? 'jira_rejected',
        error: message,
      };
    }
    return { status: 'FAILED', retryable: true, errorCode: 'jira_error', error: message };
  }
}
