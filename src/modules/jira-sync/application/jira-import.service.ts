import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BOARDS_FACADE, BoardsFacade } from '../../boards';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { adfToPlainText } from './helpers/adf-to-plain-text';
import { JIRA_GATEWAY, JiraGateway } from './jira-gateway.port';
import { toHttpError } from './jira-errors.mapper';
import { JiraStatusMappingService } from './jira-status-mapping.service';

export interface ImportResult {
  /** created + updated */
  imported: number;
  created: number;
  updated: number;
  /** Issues whose card already matched. */
  skipped: number;
}

export interface IssueLinkView {
  id: string;
  boardId: string;
  cardId: string;
  jiraIssueKey: string;
  jiraIssueId: string;
  jiraProjectKey: string;
}

const PAGE_SIZE = 50;

@Injectable()
export class JiraImportService {
  constructor(
    @InjectRepository(JiraIssueMappingEntity)
    private readonly links: Repository<JiraIssueMappingEntity>,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
    @Inject(JIRA_GATEWAY) private readonly gateway: JiraGateway,
    private readonly statusMappings: JiraStatusMappingService,
  ) {}

  /**
   * Links the board to `projectKey` (when given) and imports the project's open issues page by
   * page. Idempotent by issue key: re-running updates cards instead of duplicating them.
   */
  async import(userId: string, boardId: string, projectKey?: string): Promise<ImportResult> {
    await this.statusMappings.requireRole(userId, boardId, true);
    const linked = await this.statusMappings.requireLinkedBoard(boardId, projectKey);
    // Statuses come first: an unknown project fails here, before the key is stored.
    const statuses = await this.statusMappings.projectStatuses(boardId, linked.projectKey);
    if (linked.board.jiraProjectKey !== linked.projectKey) {
      await this.boards.setJiraProjectKey(boardId, linked.projectKey);
    }
    const columnByStatus = await this.statusMappings.columnsByStatus(linked, statuses);
    const fallbackColumn = linked.board.columns[0].id;

    const result: ImportResult = { imported: 0, created: 0, updated: 0, skipped: 0 };
    const jql = `project = "${linked.projectKey}" AND statusCategory != Done ORDER BY key`;
    let nextPageToken: string | undefined;
    do {
      const page = await this.search(boardId, jql, nextPageToken);
      for (const issue of page.issues) {
        const description = (issue.fields as unknown as { description?: unknown }).description;
        const { cardId, outcome } = await this.boards.upsertCardFromExternal({
          boardId,
          columnId: columnByStatus.get(issue.fields.status.id) ?? fallbackColumn,
          jiraIssueKey: issue.key,
          title: issue.fields.summary.slice(0, 255),
          description: adfToPlainText(description),
        });
        await this.links.upsert(
          {
            boardId,
            cardId,
            jiraIssueKey: issue.key,
            jiraIssueId: issue.id,
            jiraProjectKey: linked.projectKey,
            createdById: userId,
          },
          ['boardId', 'jiraIssueKey'],
        );
        if (outcome === 'unchanged') {
          result.skipped += 1;
        } else {
          result[outcome] += 1;
          result.imported += 1;
        }
      }
      nextPageToken = page.isLast ? undefined : (page.nextPageToken ?? undefined);
    } while (nextPageToken);

    return result;
  }

  /** Card ↔ issue links of a board; any member may read them. */
  async listLinks(userId: string, boardId: string): Promise<IssueLinkView[]> {
    await this.statusMappings.requireRole(userId, boardId, false);
    const rows = await this.links.find({ where: { boardId }, order: { jiraIssueKey: 'ASC' } });
    return rows
      .filter((row): row is JiraIssueMappingEntity & { cardId: string } => row.cardId !== null)
      .map((row) => ({
        id: row.id,
        boardId: row.boardId,
        cardId: row.cardId,
        jiraIssueKey: row.jiraIssueKey,
        jiraIssueId: row.jiraIssueId,
        jiraProjectKey: row.jiraProjectKey,
      }));
  }

  private async search(boardId: string, jql: string, nextPageToken?: string) {
    try {
      return await this.gateway.searchIssues({
        boardId,
        jql,
        nextPageToken,
        maxResults: PAGE_SIZE,
        fields: ['description'],
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
