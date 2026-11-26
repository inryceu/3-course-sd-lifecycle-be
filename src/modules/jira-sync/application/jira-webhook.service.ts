import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IncomingHttpHeaders } from 'http';
import { In, Repository } from 'typeorm';
import { BOARDS_FACADE, BoardsFacade } from '../../boards';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { JiraWebhookAuthenticityService } from './jira-webhook-authenticity.service';
import { JiraWebhookDeliveryService } from './jira-webhook-delivery.service';
import {
  buildDeliveryKey,
  parseJiraWebhookPayload,
  ParsedJiraWebhook,
} from './jira-webhook-payload';
import { JiraStatusMappingService } from './jira-status-mapping.service';
import { JiraSyncConflictDetector } from './jira-sync-conflict.detector';

type StatusDelivery = Extract<ParsedJiraWebhook, { kind: 'status' }>;

interface BoardOutcome {
  readonly board: string;
  readonly outcome: string;
}

@Injectable()
export class JiraWebhookService {
  private readonly logger = new Logger(JiraWebhookService.name);

  constructor(
    private readonly authenticity: JiraWebhookAuthenticityService,
    private readonly deliveries: JiraWebhookDeliveryService,
    private readonly statusMappings: JiraStatusMappingService,
    @InjectRepository(JiraIssueMappingEntity)
    private readonly links: Repository<JiraIssueMappingEntity>,
    @InjectRepository(JiraConnectionEntity)
    private readonly connections: Repository<JiraConnectionEntity>,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
    private readonly conflicts: JiraSyncConflictDetector,
  ) {}

  async receive(rawBody: Buffer, body: unknown, headers: IncomingHttpHeaders): Promise<void> {
    this.authenticity.verify(rawBody, headers);
    const payload = parseJiraWebhookPayload(body);
    const deliveryKey = buildDeliveryKey(payload, rawBody);
    const keyPrefix = deliveryKey.slice(0, 8);
    const startedAt = Date.now();
    const timestamp = payload.timestamp ?? '-';

    if (!(await this.deliveries.claim(deliveryKey))) {
      this.logger.log(
        `event=${payload.event} delivery=${keyPrefix} timestamp=${timestamp} outcome=duplicate`,
      );
      return;
    }

    let completed = false;
    try {
      const outcomes = await this.apply(payload);
      await this.deliveries.complete(deliveryKey);
      completed = true;
      const latencyMs = Date.now() - startedAt;
      for (const { board, outcome } of outcomes) {
        this.logger.log(
          `event=${payload.event} delivery=${keyPrefix} timestamp=${timestamp} board=${board} outcome=${outcome} latencyMs=${latencyMs}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `event=${payload.event} delivery=${keyPrefix} timestamp=${timestamp} outcome=failed error=${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      throw error;
    } finally {
      if (!completed) {
        try {
          await this.deliveries.release(deliveryKey);
        } catch (error) {
          this.logger.error(
            `delivery=${keyPrefix} outcome=release-failed error=${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    }
  }

  /**
   * The issue key is unique only per board, so the boards come from the Jira site that sent the
   * delivery; every connected board of that site holding the issue is updated.
   */
  private async apply(payload: ParsedJiraWebhook): Promise<BoardOutcome[]> {
    if (payload.kind === 'ignored') return [{ board: '-', outcome: 'ignored' }];

    const boardIds = await this.connectedBoardsOfSite(payload.issueSelf);
    if (boardIds.length === 0) return [{ board: '-', outcome: 'unknown-site' }];

    const links = await this.links.find({
      where: { boardId: In(boardIds), jiraIssueKey: payload.issueKey },
    });
    if (links.length === 0) return [{ board: '-', outcome: 'unknown-issue' }];

    const outcomes: BoardOutcome[] = [];
    for (const link of links) {
      outcomes.push({ board: link.boardId, outcome: await this.applyToBoard(link, payload) });
    }
    return outcomes;
  }

  private async applyToBoard(
    link: JiraIssueMappingEntity,
    payload: StatusDelivery,
  ): Promise<string> {
    if (!link.cardId) return 'unknown-issue';
    const board = await this.boards.getBoardSummary(link.boardId);
    if (!board || board.jiraProjectKey !== link.jiraProjectKey || board.columns.length === 0) {
      return 'unlinked';
    }
    const columns = await this.statusMappings.columnsByStatus(
      { board, projectKey: link.jiraProjectKey },
      [payload.status],
    );
    const columnId = columns.get(payload.status.id);
    if (!columnId) return 'unlinked';

    const watermark = await this.advanceWatermark(link.id, payload.timestamp);
    if (watermark === 'stale') return 'stale';

    try {
      const conflict = await this.conflicts.noteJiraChange(
        {
          linkId: link.id,
          boardId: link.boardId,
          cardId: link.cardId,
          issueKey: link.jiraIssueKey,
        },
        {
          columnId,
          statusId: payload.status.id,
          statusName: payload.status.name,
          at: payload.timestamp === null ? new Date() : new Date(Number(payload.timestamp)),
        },
      );
      // Jira wins a conflict: the card moves as for any delivery, then the conflict is logged.
      const outcome = await this.boards.moveCardFromExternal({
        boardId: link.boardId,
        jiraIssueKey: link.jiraIssueKey,
        columnId,
      });
      if (!conflict) return outcome;
      await this.conflicts.record(conflict);
      return `${outcome}+conflict`;
    } catch (error) {
      if (payload.timestamp !== null && watermark !== 'skipped') {
        await this.restoreWatermark(link.id, payload.timestamp, watermark.previous).catch(
          (restoreError: unknown) =>
            this.logger.error(
              `board=${link.boardId} outcome=watermark-restore-failed error=${
                restoreError instanceof Error ? restoreError.message : 'unknown'
              }`,
            ),
        );
      }
      throw error;
    }
  }

  // ponytail: scans jira_connections per delivery (one row per connected board); index a
  // normalised site column if that table grows large.
  private async connectedBoardsOfSite(issueSelf: string | null): Promise<string[]> {
    if (!issueSelf) return [];
    const connections = await this.connections.find({
      select: { boardId: true, cloudId: true, siteUrl: true },
    });
    return connections
      .filter((connection) => isSameSite(issueSelf, connection))
      .map((connection) => connection.boardId);
  }

  /**
   * Records this delivery's timestamp unless an equal or newer one was already applied, in one
   * statement that also returns the previous value.
   */
  private async advanceWatermark(
    linkId: string,
    timestamp: string | null,
  ): Promise<'stale' | 'skipped' | { previous: string | null }> {
    if (timestamp === null) return 'skipped';
    const rows = await this.links.query<Array<{ previous: string | null }>>(
      `WITH current AS (
         SELECT id, last_jira_event_at FROM jira_issue_mappings WHERE id = $1 FOR UPDATE
       ), advanced AS (
         UPDATE jira_issue_mappings AS m
            SET last_jira_event_at = $2
           FROM current
          WHERE m.id = current.id
            AND (current.last_jira_event_at IS NULL OR current.last_jira_event_at < $2)
         RETURNING current.last_jira_event_at AS previous
       )
       SELECT previous FROM advanced`,
      [linkId, timestamp],
    );
    return rows.length === 0 ? 'stale' : { previous: rows[0].previous };
  }

  /** Gives the watermark back after a failed move, unless a newer delivery advanced it since. */
  private async restoreWatermark(
    linkId: string,
    timestamp: string,
    previous: string | null,
  ): Promise<void> {
    await this.links.query(
      `UPDATE jira_issue_mappings SET last_jira_event_at = $3
        WHERE id = $1 AND last_jira_event_at = $2`,
      [linkId, timestamp, previous],
    );
  }
}

/** `issue.self` is on the site URL, or on api.atlassian.com/ex/jira/<cloudId>/ for OAuth apps. */
function isSameSite(
  issueSelf: string,
  connection: Pick<JiraConnectionEntity, 'cloudId' | 'siteUrl'>,
): boolean {
  try {
    const self = new URL(issueSelf);
    if (self.origin === new URL(connection.siteUrl).origin) return true;
    return (
      self.host === 'api.atlassian.com' &&
      self.pathname.startsWith(`/ex/jira/${connection.cloudId}/`)
    );
  } catch {
    return false;
  }
}
