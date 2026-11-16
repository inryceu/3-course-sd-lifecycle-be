import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AUTH_FACADE, AuthFacade } from '../../auth';
import { BOARDS_FACADE, BoardsFacade } from '../../boards';
import { DomainEventOf } from '../../../common/events/domain-events';
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
import { plainTextToAdf } from './helpers/plain-text-to-adf';
import { JIRA_GATEWAY, AddCommentInput, JiraGateway } from './jira-gateway.port';

const SYNC_BUDGET_MS = 5_000;
const MIN_CALL_BUDGET_MS = 250;
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}-\d+$/;
const UNKNOWN_AUTHOR = 'Unknown user';

type FailureReason =
  'invalid issue key' | 'issue not found' | 'deadline exceeded' | 'jira error' | 'sync failed';

interface SyncLogOutcome {
  status: SyncStatus;
  payload: Record<string, unknown>;
  errorMessage: string | null;
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

/** Mirrors one user comment to its card's Jira issue and records the attempt. */
@Injectable()
export class JiraCommentSyncService {
  private readonly logger = new Logger(JiraCommentSyncService.name);

  constructor(
    @InjectRepository(JiraIssueMappingEntity)
    private readonly links: Repository<JiraIssueMappingEntity>,
    @Inject(JIRA_GATEWAY) private readonly gateway: JiraGateway,
    @Inject(AUTH_FACADE) private readonly auth: AuthFacade,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
    @InjectRepository(SyncLogEntity)
    private readonly logs: Repository<SyncLogEntity>,
  ) {}

  async syncComment(event: DomainEventOf<'card.commented'>): Promise<void> {
    if (event.origin !== 'user') {
      return;
    }

    const startedAt = this.startedAt(event.occurredAt);
    const deadline = startedAt + SYNC_BUDGET_MS;
    const commentId = event.payload.id;
    let mappingId: string | null = null;
    let issueKey: string | null = null;
    let outcome: SyncLogOutcome;

    try {
      const link = await this.links.findOne({
        where: { boardId: event.boardId, cardId: event.payload.cardId },
        select: { id: true, jiraIssueKey: true },
      });
      if (link === null) {
        this.logger.debug(`Skipping Jira comment sync for unlinked card ${event.payload.cardId}`);
        return;
      }

      mappingId = link.id;
      issueKey = link.jiraIssueKey;
      if (!ISSUE_KEY_PATTERN.test(issueKey)) {
        throw new SyncFailure('invalid issue key', `"${issueKey}" is not a Jira issue key`);
      }

      const timeBudgetMs = this.callBudget(deadline);
      const displayName = await this.resolveAuthor(event.payload.authorId, commentId);
      const input: AddCommentInput = {
        boardId: event.boardId,
        issueIdOrKey: issueKey,
        body: plainTextToAdf(`[BoardSync] ${displayName}: ${event.payload.text}`),
        timeBudgetMs,
      };
      const created = await this.gateway.addComment(input);

      try {
        await this.boards.markCommentSynced(event.payload.cardId, commentId);
      } catch (error) {
        this.logger.error(
          `Jira comment ${created.id} was posted for ${issueKey}, but local comment ${commentId} could not be marked synced: ${this.message(error)}`,
        );
      }

      outcome = {
        status: SyncStatus.SUCCESS,
        payload: {
          commentId,
          cardId: event.payload.cardId,
          issueKey,
          jiraCommentId: created.id,
        },
        errorMessage: null,
      };
    } catch (error) {
      const failure = this.failureFrom(error);
      outcome = {
        status: SyncStatus.FAILED,
        payload: {
          commentId,
          cardId: event.payload.cardId,
          issueKey,
          reason: failure.reason,
        },
        errorMessage: failure.message,
      };
    }

    const latencyMs = Math.max(0, Date.now() - startedAt);
    const payload = { ...outcome.payload, latencyMs };
    const target = issueKey ?? 'unmapped mapping';

    if (outcome.status === SyncStatus.FAILED) {
      this.logger.error(
        `Jira comment sync failed for ${target} on board ${event.boardId}: ${String(payload['reason'])}`,
        outcome.errorMessage ?? undefined,
      );
    } else if (latencyMs > SYNC_BUDGET_MS) {
      this.logger.warn(
        `Jira comment sync for ${target} on board ${event.boardId} took ${latencyMs}ms`,
      );
    } else {
      this.logger.log(
        `Jira comment sync for ${target} on board ${event.boardId} completed in ${latencyMs}ms`,
      );
    }

    await this.logs.save({
      direction: SyncDirection.TO_JIRA,
      status: outcome.status,
      payload,
      errorMessage: outcome.errorMessage,
      mappingId,
    });
  }

  private async resolveAuthor(authorId: string, commentId: string): Promise<string> {
    try {
      const user = await this.auth.getUserById(authorId);
      const displayName = user?.displayName.trim();
      return displayName ? displayName : UNKNOWN_AUTHOR;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve author ${authorId} for comment ${commentId}: ${this.message(error)}`,
      );
      return UNKNOWN_AUTHOR;
    }
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
    if (error instanceof JiraClientError && error.status === 404) {
      return { reason: 'issue not found', message: error.message };
    }
    if (error instanceof JiraTimeBudgetExceededError || error instanceof JiraTimeoutError) {
      return { reason: 'deadline exceeded', message: error.message };
    }
    if (error instanceof JiraGatewayError) {
      return { reason: 'jira error', message: error.message };
    }
    return { reason: 'sync failed', message: this.message(error) };
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
