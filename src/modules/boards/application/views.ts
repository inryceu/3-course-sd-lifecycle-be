import { BoardRole, ColumnType } from '../domain/board-role';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { CardEntity } from '../infrastructure/persistence/card.entity';

/** API-shaped read models (dates as ISO strings). They match `docs/api/openapi.yaml`. */

export interface BoardView {
  id: string;
  title: string;
  description: string | null;
  jiraProjectKey: string | null;
  myRole: BoardRole;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnView {
  id: string;
  boardId: string;
  title: string;
  type: ColumnType;
  position: number;
}

export interface CardView {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  deadline: string | null;
  jiraIssueKey: string | null;
  position: number;
  assigneeId: string | null;
  labelIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ColumnWithCardsView extends ColumnView {
  cards: CardView[];
}

export interface BoardDetailView extends BoardView {
  columns: ColumnWithCardsView[];
}

export const toBoardView = (board: BoardEntity, myRole: BoardRole): BoardView => ({
  id: board.id,
  title: board.title,
  description: board.description ?? null,
  jiraProjectKey: board.jiraProjectKey ?? null,
  myRole,
  createdAt: board.createdAt.toISOString(),
  updatedAt: board.updatedAt.toISOString(),
});

export const toColumnView = (column: BoardColumnEntity): ColumnView => ({
  id: column.id,
  boardId: column.boardId,
  title: column.title,
  type: column.type,
  position: column.position,
});

export const toCardView = (card: CardEntity): CardView => ({
  id: card.id,
  boardId: card.boardId,
  columnId: card.columnId,
  title: card.title,
  description: card.description ?? null,
  deadline: card.deadline ? new Date(card.deadline).toISOString() : null,
  jiraIssueKey: card.jiraIssueKey ?? null,
  position: card.position,
  assigneeId: card.assigneeId ?? null,
  labelIds: (card.labels ?? []).map((label) => label.id),
  createdAt: card.createdAt.toISOString(),
  updatedAt: card.updatedAt.toISOString(),
});

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

export const toBoardDetailView = (board: BoardEntity, myRole: BoardRole): BoardDetailView => ({
  ...toBoardView(board, myRole),
  columns: [...(board.columns ?? [])].sort(byPosition).map((column) => ({
    ...toColumnView(column),
    cards: [...(column.cards ?? [])].sort(byPosition).map(toCardView),
  })),
});
