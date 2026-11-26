import { DataSource, EntityManager, Repository } from 'typeorm';
import { EventPublisher } from '../../../common/events';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { BoardRole } from '../domain/board-role';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { BoardAccessService } from './board-access.service';
import { CardsService } from './cards.service';

/** The Jira intent is written in the move's own transaction (T-35): when and with what. */
function setup(
  options: {
    jiraProjectKey?: string | null;
    jiraIssueKey?: string | null;
    targetColumnId?: string;
    enqueueError?: Error;
  } = {},
) {
  const jiraIssueKey = options.jiraIssueKey === undefined ? 'KAN-1' : options.jiraIssueKey;
  const targetColumnId = options.targetColumnId ?? 'col-2';
  const current = {
    id: 'card-1',
    columnId: 'col-1',
    position: 0,
    boardId: 'b1',
    moveTo: jest.fn(function (this: Record<string, unknown>, target: { id: string }, p: number) {
      this.columnId = target.id;
      this.position = p;
    }),
  };
  const moved = {
    id: 'card-1',
    columnId: targetColumnId,
    position: 0,
    boardId: 'b1',
    title: 'Card',
    description: null,
    deadline: null,
    jiraIssueKey,
    assigneeId: null,
    labels: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const builder = {
    setLock: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue({
      id: 'b1',
      jiraProjectKey: options.jiraProjectKey === undefined ? 'KAN' : options.jiraProjectKey,
    }),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const manager = {
    createQueryBuilder: jest.fn(() => builder),
    findOne: jest.fn().mockImplementation((entity: unknown) => {
      if (entity === CardEntity) return Promise.resolve(current);
      if (entity === BoardColumnEntity)
        return Promise.resolve({ id: targetColumnId, boardId: 'b1' });
      return Promise.resolve(null);
    }),
    count: jest.fn().mockResolvedValue(3),
    update: jest.fn().mockResolvedValue(undefined),
    findOneOrFail: jest.fn().mockResolvedValue(moved),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn((work: (m: EntityManager) => Promise<unknown>) => work(manager)),
  } as unknown as DataSource;
  const outbox = {
    enqueue: options.enqueueError
      ? jest.fn().mockRejectedValue(options.enqueueError)
      : jest.fn().mockResolvedValue({ id: 'o1', coalesced: false }),
  };
  const events = { publish: jest.fn().mockResolvedValue(undefined) };
  const access = { requireEditor: jest.fn().mockResolvedValue(BoardRole.MEMBER) };
  const service = new CardsService(
    dataSource,
    {} as Repository<CardEntity>,
    {} as Repository<BoardColumnEntity>,
    access as unknown as BoardAccessService,
    events as unknown as EventPublisher,
    outbox as unknown as OutboxService,
  );
  jest
    .spyOn(service as unknown as { findCard: () => Promise<unknown> }, 'findCard')
    .mockResolvedValue({ boardId: 'b1' });
  return { service, outbox, events, manager };
}

const MOVE = { columnId: 'col-2', position: 0 };

describe('CardsService.move: Jira outbox intent', () => {
  it('enqueues one TRANSITION_ISSUE on the caller transaction for a linked card', async () => {
    const { service, outbox, manager } = setup();
    await service.move('u1', 'card-1', MOVE);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(manager, {
      operation: 'TRANSITION_ISSUE',
      boardId: 'b1',
      cardId: 'card-1',
      actorId: 'u1',
      payload: {
        cardId: 'card-1',
        boardId: 'b1',
        jiraIssueKey: 'KAN-1',
        fromColumnId: 'col-1',
        targetColumnId: 'col-2',
        occurredAt: expect.any(String) as unknown,
      },
    });
    expect(Number.isNaN(Date.parse(outbox.enqueue.mock.calls[0][1].payload.occurredAt))).toBe(
      false,
    );
  });

  it('enqueues nothing for a card without an issue key or a board without a project', async () => {
    const noKey = setup({ jiraIssueKey: null });
    await noKey.service.move('u1', 'card-1', MOVE);
    expect(noKey.outbox.enqueue).not.toHaveBeenCalled();

    const unlinked = setup({ jiraProjectKey: null });
    await unlinked.service.move('u1', 'card-1', MOVE);
    expect(unlinked.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues nothing for a reorder inside the same column', async () => {
    const { service, outbox } = setup({ targetColumnId: 'col-1' });
    await service.move('u1', 'card-1', { columnId: 'col-1', position: 1 });
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('fails the move, and publishes nothing, when the intent cannot be stored', async () => {
    const { service, events } = setup({ enqueueError: new Error('outbox down') });
    await expect(service.move('u1', 'card-1', MOVE)).rejects.toThrow('outbox down');
    expect(events.publish).not.toHaveBeenCalled();
  });
});
