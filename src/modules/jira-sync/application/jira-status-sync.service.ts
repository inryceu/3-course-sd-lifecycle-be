import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DomainEventOf } from '../../../common/events/domain-events';
import { BOARDS_FACADE, BoardsFacade } from '../../boards';
import {
  JiraClientError,
  JiraGatewayError,
  JiraTimeBudgetExceededError,
  JiraTimeoutError,
} from '../domain/jira-gateway.errors';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import {
  SyncDirection,
  SyncLogEntity,
  SyncStatus,
} from '../infrastructure/persistence/sync-log.entity';
import { JIRA_GATEWAY, JiraGateway, JiraStatus, JiraTransition } from './jira-gateway.port';
import {
  JiraStatusMappingService,
  LinkedBoard,
  StatusMappingView,
} from './jira-status-mapping.service';

const SYNC_BUDGET_MS = 5_000;
const MIN_CALL_BUDGET_MS = 250;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}-\d+$/;

type FailureReason =
  | 'invalid issue key'
  | 'issue not found'
  | 'board not linked'
  | 'no valid transition'
  | 'deadline exceeded'
  | 'jira error'
  | 'sync failed';

interface SyncLogResult {
  readonly status: SyncStatus;
  readonly payload: Record<string, unknown>;
  readonly errorMessage: string | null;
  readonly mappingId: string | null;
  readonly reason?: FailureReason;
}

interface TransitionCandidate {
  readonly transition: JiraTransition;
  readonly mapping: StatusMappingView;
}

class SyncFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string = reason,
  ) {
    super(message);
    this.name = 'SyncFailure';
  }
}

/** Applies one user card move to Jira and records the attempt in `sync_logs`. */
@Injectable()
export class JiraStatusSyncService {
  private readonly logger = new Logger(JiraStatusSyncService.name);

  constructor(
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
    private readonly statusMappings: JiraStatusMappingService,
    @Inject(JIRA_GATEWAY) private readonly gateway: JiraGateway,
    @InjectRepository(SyncLogEntity)
    private readonly logs: Repository<SyncLogEntity>,
    @InjectRepository(JiraIssueMappingEntity)
    private readonly links: Repository<JiraIssueMappingEntity>,
  ) {}

  async syncCardMove(event: DomainEventOf<'card.moved'>): Promise<void> {
    const issueKey = event.payload.card.jiraIssueKey;
    if (
      event.origin !== 'user' ||
      event.payload.fromColumnId === event.payload.toColumnId ||
      issueKey === null
    ) {
      return;
    }

    const startedAt = this.startedAt(event.occurredAt);
    const deadline = startedAt + SYNC_BUDGET_MS;
    const result = await this.run(event, issueKey, deadline);
    const latencyMs = Math.max(0, Date.now() - startedAt);

    if (latencyMs > SYNC_BUDGET_MS) {
      this.logger.warn(
        `Jira status sync for ${issueKey} on board ${event.boardId} took ${latencyMs}ms`,
      );
    }
    if (result.status === SyncStatus.FAILED) {
      this.logger.error(
        `Jira status sync failed for ${issueKey} on board ${event.boardId}: ${result.reason ?? 'sync failed'}`,
        result.errorMessage ?? undefined,
      );
    } else {
      this.logger.debug(`Jira status sync for ${issueKey} on board ${event.boardId} completed`);
    }

    await this.logs.save({
      direction: SyncDirection.TO_JIRA,
      status: result.status,
      payload: { ...result.payload, latencyMs },
      errorMessage: result.errorMessage,
      mappingId: result.mappingId,
    });
  }

  private async run(
    event: DomainEventOf<'card.moved'>,
    issueKey: string,
    deadline: number,
  ): Promise<SyncLogResult> {
    const { card, fromColumnId, toColumnId } = event.payload;
    let mappingId: string | null = null;

    try {
      mappingId = await this.findMappingId(event.boardId, issueKey);
      const linked = await this.resolveLinkedBoard(event.boardId);
      if (!ISSUE_KEY_PATTERN.test(issueKey)) {
        throw new SyncFailure('invalid issue key', `"${issueKey}" is not a Jira issue key`);
      }

      const issue = await this.getIssue(event.boardId, issueKey, deadline);
      const [current] = await this.statusMappings.resolveMappings(linked, [issue.status]);
      if (current.columnId === toColumnId) {
        return {
          status: SyncStatus.SUCCESS,
          payload: {
            cardId: card.id,
            issueKey,
            fromColumnId,
            toColumnId,
            outcome: 'no-op',
            targetStatusId: issue.status.id,
            targetStatusName: issue.status.name,
          },
          errorMessage: null,
          mappingId,
        };
      }

      const transitions = await this.listTransitions(event.boardId, issueKey, deadline);
      const targets = this.uniqueTargets(transitions);
      const targetMappings = await this.statusMappings.resolveMappings(linked, targets);
      const mappingByStatusId = new Map(
        targetMappings.map((mapping) => [mapping.jiraStatusId, mapping]),
      );
      const candidates = transitions
        .filter((transition) => transition.isAvailable)
        .map((transition) => {
          const mapping = mappingByStatusId.get(transition.to.id);
          return mapping === undefined ? null : { transition, mapping };
        })
        .filter(
          (candidate): candidate is TransitionCandidate =>
            candidate !== null && candidate.mapping.columnId === toColumnId,
        )
        .sort((left, right) => this.compareCandidates(left, right));

      if (candidates.length === 0) {
        throw new SyncFailure(
          'no valid transition',
          `No available transition targets column ${toColumnId}`,
        );
      }

      const chosen = candidates[0];
      await this.doTransition(event.boardId, issueKey, chosen.transition.id, deadline);
      return {
        status: SyncStatus.SUCCESS,
        payload: {
          cardId: card.id,
          issueKey,
          fromColumnId,
          toColumnId,
          outcome: 'transitioned',
          targetStatusId: chosen.transition.to.id,
          targetStatusName: chosen.transition.to.name,
          transitionId: chosen.transition.id,
        },
        errorMessage: null,
        mappingId,
      };
    } catch (error) {
      const failure = this.failureFrom(error);
      return {
        status: SyncStatus.FAILED,
        payload: {
          cardId: card.id,
          issueKey,
          fromColumnId,
          toColumnId,
          reason: failure.reason,
        },
        errorMessage: failure.message,
        mappingId,
        reason: failure.reason,
      };
    }
  }

  private async resolveLinkedBoard(boardId: string): Promise<LinkedBoard> {
    const board = await this.boards.getBoardSummary(boardId);
    if (board === null || board.jiraProjectKey === null) {
      throw new SyncFailure('board not linked', 'Board is not linked to a Jira project');
    }
    try {
      return await this.statusMappings.requireLinkedBoard(boardId);
    } catch (error) {
      throw new SyncFailure('board not linked', this.message(error));
    }
  }

  private async getIssue(boardId: string, issueKey: string, deadline: number) {
    try {
      return await this.gateway.getIssue({
        boardId,
        issueIdOrKey: issueKey,
        timeBudgetMs: this.callBudget(deadline),
      });
    } catch (error) {
      if (error instanceof JiraClientError && error.status === 404) {
        throw new SyncFailure('issue not found', error.message);
      }
      throw error;
    }
  }

  private async listTransitions(
    boardId: string,
    issueKey: string,
    deadline: number,
  ): Promise<readonly JiraTransition[]> {
    const result = await this.gateway.listTransitions({
      boardId,
      issueIdOrKey: issueKey,
      includeUnavailableTransitions: false,
      timeBudgetMs: this.callBudget(deadline),
    });
    return result.transitions;
  }

  private async doTransition(
    boardId: string,
    issueKey: string,
    transitionId: string,
    deadline: number,
  ): Promise<void> {
    await this.gateway.doTransition({
      boardId,
      issueIdOrKey: issueKey,
      transitionId,
      timeBudgetMs: this.callBudget(deadline),
    });
  }

  private async findMappingId(boardId: string, issueKey: string): Promise<string | null> {
    const link = await this.links.findOne({
      where: { boardId, jiraIssueKey: issueKey },
      select: { id: true },
    });
    return link?.id ?? null;
  }

  private uniqueTargets(transitions: readonly JiraTransition[]): JiraStatus[] {
    const byId = new Map<string, JiraStatus>();
    for (const transition of transitions) {
      if (!byId.has(transition.to.id)) {
        byId.set(transition.to.id, transition.to);
      }
    }
    return [...byId.values()];
  }

  private compareCandidates(left: TransitionCandidate, right: TransitionCandidate): number {
    if (left.mapping.isDefault !== right.mapping.isDefault) {
      return left.mapping.isDefault ? 1 : -1;
    }
    return (
      this.compareIds(left.mapping.jiraStatusId, right.mapping.jiraStatusId) ||
      this.compareIds(left.transition.id, right.transition.id)
    );
  }

  private compareIds(left: string, right: string): number {
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      return Number(left) - Number(right);
    }
    return left.localeCompare(right);
  }

  private callBudget(deadline: number): number {
    const remaining = Math.min(deadline - Date.now(), SYNC_BUDGET_MS);
    if (remaining < MIN_CALL_BUDGET_MS) {
      throw new SyncFailure(
        'deadline exceeded',
        'The five-second synchronization budget is exhausted',
      );
    }
    return remaining;
  }

  private startedAt(occurredAt: string): number {
    const parsed = Date.parse(occurredAt);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

  private failureFrom(error: unknown): { reason: FailureReason; message: string } {
    if (error instanceof SyncFailure) {
      return { reason: error.reason, message: error.message };
    }
    if (error instanceof JiraTimeBudgetExceededError || error instanceof JiraTimeoutError) {
      return { reason: 'deadline exceeded', message: this.message(error) };
    }
    if (error instanceof JiraGatewayError) {
      return { reason: 'jira error', message: this.message(error) };
    }
    return { reason: 'sync failed', message: this.message(error) };
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
