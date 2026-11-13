import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BOARDS_FACADE, BoardRole, BoardsFacade, BoardSummary, ColumnType } from '../../boards';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraStatusMappingEntity } from '../infrastructure/persistence/jira-status-mapping.entity';
import { JIRA_GATEWAY, JiraGateway, JiraStatus } from './jira-gateway.port';
import { toHttpError } from './jira-errors.mapper';

export interface StatusMappingView {
  jiraStatusId: string;
  jiraStatusName: string;
  statusCategory: string;
  columnId: string;
  isDefault: boolean;
}

/** A board that is connected to Jira and linked to a project, as the mapping and import need it. */
export interface LinkedBoard {
  board: BoardSummary;
  projectKey: string;
}

const CATEGORY_COLUMN: Record<string, ColumnType> = {
  new: ColumnType.TODO,
  indeterminate: ColumnType.IN_PROGRESS,
  done: ColumnType.DONE,
};

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}$/;

@Injectable()
export class JiraStatusMappingService {
  constructor(
    @InjectRepository(JiraStatusMappingEntity)
    private readonly mappings: Repository<JiraStatusMappingEntity>,
    @InjectRepository(JiraConnectionEntity)
    private readonly connections: Repository<JiraConnectionEntity>,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
    @Inject(JIRA_GATEWAY) private readonly gateway: JiraGateway,
  ) {}

  /** Any member may read; statuses without a stored row get the category default. */
  async list(userId: string, boardId: string): Promise<StatusMappingView[]> {
    await this.requireRole(userId, boardId, false);
    const linked = await this.requireLinkedBoard(boardId);
    return this.resolve(linked, await this.projectStatuses(boardId, linked.projectKey));
  }

  /** Admin only. Every status must belong to the project and every column to the board. */
  async save(
    userId: string,
    boardId: string,
    entries: ReadonlyArray<{ jiraStatusId: string; columnId: string }>,
  ): Promise<StatusMappingView[]> {
    await this.requireRole(userId, boardId, true);
    const linked = await this.requireLinkedBoard(boardId);
    const statuses = await this.projectStatuses(boardId, linked.projectKey);
    const statusById = new Map(statuses.map((s) => [s.id, s]));
    const columnIds = new Set(linked.board.columns.map((c) => c.id));

    for (const entry of entries) {
      if (!statusById.has(entry.jiraStatusId)) {
        throw new BadRequestException(
          `Status ${entry.jiraStatusId} is not used by project ${linked.projectKey}`,
        );
      }
      if (!columnIds.has(entry.columnId)) {
        throw new BadRequestException(`Column ${entry.columnId} does not belong to this board`);
      }
    }
    if (entries.length > 0) {
      await this.mappings.upsert(
        entries.map((entry) => ({
          boardId,
          jiraStatusId: entry.jiraStatusId,
          jiraStatusName: statusById.get(entry.jiraStatusId)?.name ?? entry.jiraStatusId,
          columnId: entry.columnId,
        })),
        ['boardId', 'jiraStatusId'],
      );
    }
    return this.resolve(linked, statuses);
  }

  /** Column for each status id, stored or default. Used by the import. */
  async columnsByStatus(linked: LinkedBoard, statuses: JiraStatus[]): Promise<Map<string, string>> {
    const views = await this.resolve(linked, statuses);
    return new Map(views.map((v) => [v.jiraStatusId, v.columnId]));
  }

  async projectStatuses(boardId: string, projectKey: string): Promise<JiraStatus[]> {
    try {
      return await this.gateway.listProjectStatuses({ boardId, projectKey });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** 404 for strangers (the board's existence is not revealed), 403 for a too weak role. */
  async requireRole(userId: string, boardId: string, admin: boolean): Promise<BoardRole> {
    const role = await this.boards.getMemberRole(boardId, userId);
    if (!role) {
      throw new NotFoundException('Board not found');
    }
    if (admin && role !== BoardRole.ADMIN) {
      throw new ForbiddenException('Only a board admin can manage the Jira link');
    }
    return role;
  }

  /** The board must exist (404) and be connected to Jira (409). */
  async requireConnectedBoard(boardId: string): Promise<BoardSummary> {
    const board = await this.boards.getBoardSummary(boardId);
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    if (!(await this.connections.exist({ where: { boardId } }))) {
      throw new ConflictException('Connect this board to Jira first');
    }
    return board;
  }

  /** The board must be connected to Jira and (unless `projectKey` is given) linked to a project. */
  async requireLinkedBoard(boardId: string, projectKey?: string): Promise<LinkedBoard> {
    const board = await this.requireConnectedBoard(boardId);
    const key = projectKey ?? board.jiraProjectKey;
    if (!key) {
      throw new BadRequestException('Link the board to a Jira project first (projectKey)');
    }
    if (!PROJECT_KEY_PATTERN.test(key)) {
      throw new BadRequestException(`"${key}" is not a Jira project key`);
    }
    return { board, projectKey: key };
  }

  private async resolve(linked: LinkedBoard, statuses: JiraStatus[]): Promise<StatusMappingView[]> {
    const stored = await this.mappings.find({ where: { boardId: linked.board.id } });
    const storedById = new Map(stored.map((m) => [m.jiraStatusId, m]));
    const columnIds = new Set(linked.board.columns.map((c) => c.id));

    return statuses.map((status) => {
      const row = storedById.get(status.id);
      // A stored column that was deleted since falls back to the default.
      if (row && columnIds.has(row.columnId)) {
        return this.view(status, row.columnId, false);
      }
      return this.view(status, this.defaultColumn(linked.board, status), true);
    });
  }

  private defaultColumn(board: BoardSummary, status: JiraStatus): string {
    const wanted = CATEGORY_COLUMN[status.statusCategory?.key ?? ''] ?? ColumnType.TODO;
    return (board.columns.find((c) => c.type === wanted) ?? board.columns[0]).id;
  }

  private view(status: JiraStatus, columnId: string, isDefault: boolean): StatusMappingView {
    return {
      jiraStatusId: status.id,
      jiraStatusName: status.name,
      statusCategory: status.statusCategory?.key ?? 'undefined',
      columnId,
      isDefault,
    };
  }
}
