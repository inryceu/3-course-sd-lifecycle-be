import { BoardSnapshot, CardSnapshot } from '../../../common/events';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { CardView } from './views';

/** Event payloads are API-shaped snapshots, never entities. */

export const toBoardSnapshot = (board: BoardEntity): BoardSnapshot => ({
  id: board.id,
  title: board.title,
  description: board.description ?? null,
  jiraProjectKey: board.jiraProjectKey ?? null,
  createdAt: board.createdAt.toISOString(),
  updatedAt: board.updatedAt.toISOString(),
});

export const toCardSnapshot = (card: CardView): CardSnapshot => ({ ...card });
