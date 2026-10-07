/**
 * Typed domain events used for fan-out only (realtime delivery, Jira sync).
 * The names are part of the public contract in `docs/api/ws-events.md`.
 */

/** Where a change came from. The Jira outbound sync ignores `jira` to avoid sync loops. */
export type EventOrigin = 'user' | 'jira';

export const DOMAIN_EVENT_TYPES = [
  'card.created',
  'card.updated',
  'card.moved',
  'card.commented',
  'board.updated',
  'notification.created',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface CardSnapshot {
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

export interface CommentSnapshot {
  id: string;
  cardId: string;
  authorId: string;
  text: string;
  syncedToJira: boolean;
  createdAt: string;
}

export interface BoardSnapshot {
  id: string;
  title: string;
  description: string | null;
  jiraProjectKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSnapshot {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface EventPayloads {
  'card.created': CardSnapshot;
  'card.updated': CardSnapshot;
  'card.moved': {
    card: CardSnapshot;
    fromColumnId: string;
    toColumnId: string;
    position: number;
  };
  'card.commented': CommentSnapshot;
  'board.updated': { board: BoardSnapshot };
  'notification.created': { recipientId: string; notification: NotificationSnapshot };
}

export interface DomainEventOf<T extends DomainEventType> {
  type: T;
  boardId: string;
  /** User who caused the change; absent for system or Jira originated changes. */
  actorId?: string;
  origin: EventOrigin;
  /** ISO-8601 timestamp. */
  occurredAt: string;
  payload: EventPayloads[T];
}

export type DomainEvent = { [T in DomainEventType]: DomainEventOf<T> }[DomainEventType];

export interface NewEventInput<T extends DomainEventType> {
  boardId: string;
  actorId?: string;
  origin?: EventOrigin;
  occurredAt?: Date;
  payload: EventPayloads[T];
}

/** Builds an event envelope; origin defaults to `user`. */
export function createEvent<T extends DomainEventType>(
  type: T,
  input: NewEventInput<T>,
): DomainEventOf<T> {
  return {
    type,
    boardId: input.boardId,
    ...(input.actorId ? { actorId: input.actorId } : {}),
    origin: input.origin ?? 'user',
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    payload: input.payload,
  };
}
