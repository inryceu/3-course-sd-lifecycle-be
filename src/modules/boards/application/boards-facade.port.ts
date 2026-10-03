import { BoardRole } from '../domain/board-role';

/**
 * Port other modules (jira-sync) use to ask about board membership without touching board tables.
 * Exported through the module's public API only.
 */
export const BOARDS_FACADE = Symbol('BOARDS_FACADE');

export interface BoardsFacade {
  /** The user's role on the board, or null when the user is not a member or the board is unknown. */
  getMemberRole(boardId: string, userId: string): Promise<BoardRole | null>;
}
