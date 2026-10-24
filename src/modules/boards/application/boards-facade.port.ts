import { BoardRole } from '../domain/board-role';

export interface ExternalCardInput {
  boardId: string;
  columnId: string;
  jiraIssueKey: string;
  title: string;
  description?: string | null;
}

export interface ExternalCardMove {
  boardId: string;
  jiraIssueKey: string;
  columnId: string;
  position: number;
}

export const BOARDS_FACADE = Symbol('BOARDS_FACADE');

export interface BoardsFacade {
  getMemberRole(boardId: string, userId: string): Promise<BoardRole | null>;
  moveCardFromExternal(input: ExternalCardMove): Promise<'moved' | 'unchanged' | 'not-found'>;
}
