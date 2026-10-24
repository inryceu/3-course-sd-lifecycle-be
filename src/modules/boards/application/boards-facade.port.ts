import { BoardRole, ColumnType } from '../domain/board-role';

/**
 * Port other modules (jira-sync) use to read and change boards without touching board tables.
 * Exported through the module's public API only.
 */
export interface ExternalCardInput {
  boardId: string;
  columnId: string;
  jiraIssueKey: string;
  title: string;
  /** `undefined` keeps the stored description. */
  description?: string | null;
}

export interface ExternalCardMove {
  boardId: string;
  jiraIssueKey: string;
  columnId: string;
  position: number;
}

export interface ExternalUpsertResult {
  cardId: string;
  outcome: 'created' | 'updated' | 'unchanged';
}

export interface BoardColumnSummary {
  id: string;
  title: string;
  type: ColumnType;
  position: number;
}

export interface BoardSummary {
  id: string;
  jiraProjectKey: string | null;
  /** Ordered by position. */
  columns: BoardColumnSummary[];
}

export const BOARDS_FACADE = Symbol('BOARDS_FACADE');

export interface BoardsFacade {
  /** The user's role on the board, or null when the user is not a member or the board is unknown. */
  getMemberRole(boardId: string, userId: string): Promise<BoardRole | null>;
  /** Columns and Jira project key of a board, or null when the board does not exist. */
  getBoardSummary(boardId: string): Promise<BoardSummary | null>;
  /** Links the board to a Jira project (no permission check: callers check the Admin role). */
  setJiraProjectKey(boardId: string, projectKey: string): Promise<void>;
  /**
   * Creates or updates the card of a Jira issue (matched by key) in `columnId`; an existing card is
   * moved to the end of `columnId` when it sits elsewhere. Publishes events with origin `jira`.
   */
  upsertCardFromExternal(input: ExternalCardInput): Promise<ExternalUpsertResult>;
  moveCardFromExternal(input: ExternalCardMove): Promise<'moved' | 'unchanged' | 'not-found'>;
}
