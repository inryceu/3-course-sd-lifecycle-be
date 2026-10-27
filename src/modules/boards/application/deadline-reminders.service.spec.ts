import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { DomainEventOf, EventPublisher } from '../../../common/events';
import { BoardRole } from '../domain/board-role';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { BoardColumnEntity } from '../infrastructure/persistence/column.entity';
import { BoardAccessService } from './board-access.service';
import { CardsService } from './cards.service';
import { DeadlineRemindersService, REMINDER_WINDOW_MS } from './deadline-reminders.service';

const NOW = new Date('2026-10-27T10:00:00.000Z');

const config = (intervalSeconds: number) =>
  ({ getOrThrow: jest.fn().mockReturnValue(intervalSeconds) }) as unknown as ConfigService;

const publisher = (): EventPublisher & { publish: jest.Mock } => ({
  publish: jest.fn().mockResolvedValue(undefined),
});

/** A transaction whose UPDATE claims `claimed` and whose save assigns ids and timestamps. */
function dataSourceClaiming(claimed: object[]) {
  const manager = {
    query: jest.fn().mockResolvedValue([claimed, claimed.length]),
    create: jest.fn((_entity: unknown, values: object) => values),
    save: jest.fn((rows: object[]) =>
      Promise.resolve(
        rows.map((row, index) => ({
          ...row,
          id: `n${index}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      ),
    ),
  };
  const dataSource = {
    transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) => work(manager)),
  } as unknown as DataSource & { transaction: jest.Mock };
  return { dataSource, manager };
}

describe('DeadlineRemindersService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  describe('scheduler', () => {
    it('runs once per configured interval and stops on shutdown', async () => {
      const service = new DeadlineRemindersService({} as DataSource, config(60), publisher());
      const run = jest.spyOn(service, 'runOnce').mockResolvedValue(0);

      service.onModuleInit();
      jest.advanceTimersByTime(59_999);
      expect(run).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(run).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(120_000);
      expect(run).toHaveBeenCalledTimes(3);

      service.onModuleDestroy();
      jest.advanceTimersByTime(600_000);
      expect(run).toHaveBeenCalledTimes(3);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('starts no timer when the interval is 0', () => {
      const service = new DeadlineRemindersService({} as DataSource, config(0), publisher());
      service.onModuleInit();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('skips a tick while the previous run is still in progress, and survives a failed run', async () => {
      const service = new DeadlineRemindersService({} as DataSource, config(1), publisher());
      let finish!: () => void;
      const run = jest
        .spyOn(service, 'runOnce')
        .mockImplementationOnce(() => new Promise<number>((resolve) => (finish = () => resolve(0))))
        .mockRejectedValueOnce(new Error('database down'))
        .mockResolvedValue(0);

      service.onModuleInit();
      jest.advanceTimersByTime(3_000);
      expect(run).toHaveBeenCalledTimes(1);

      finish();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(run).toHaveBeenCalledTimes(2); // rejected, logged
      await jest.advanceTimersByTimeAsync(1_000);
      expect(run).toHaveBeenCalledTimes(3);
      service.onModuleDestroy();
    });
  });

  describe('runOnce', () => {
    const claimed = {
      id: 'card-1',
      board_id: 'board-1',
      title: 'Ship it',
      deadline: new Date(NOW.getTime() + 3 * 3600_000),
      assignee_id: 'bob',
    };

    it('claims cards due in the next 24 h (UTC clock) and stores one notification each', async () => {
      const { dataSource, manager } = dataSourceClaiming([claimed]);
      const service = new DeadlineRemindersService(dataSource, config(60), publisher());

      await expect(service.runOnce()).resolves.toBe(1);

      const [sql, params] = manager.query.mock.calls[0] as [string, Date[]];
      expect(sql).toContain('reminder_sent_at IS NULL');
      expect(sql).toContain('assignee_id IS NOT NULL');
      expect(params[0].toISOString()).toBe('2026-10-27T10:00:00.000Z');
      expect(params[1].getTime() - params[0].getTime()).toBe(REMINDER_WINDOW_MS);
      expect(manager.save).toHaveBeenCalledWith([
        {
          recipientId: 'bob',
          boardId: 'board-1',
          type: 'deadline.reminder',
          payload: {
            cardId: 'card-1',
            boardId: 'board-1',
            cardTitle: 'Ship it',
            deadline: '2026-10-27T13:00:00.000Z',
          },
          readAt: null,
        },
      ]);
    });

    it('publishes notification.created to the recipient after the transaction', async () => {
      const { dataSource } = dataSourceClaiming([claimed]);
      const order: string[] = [];
      const inner = dataSource.transaction.getMockImplementation() as (
        work: never,
      ) => Promise<unknown>;
      dataSource.transaction.mockImplementation(async (work: never) => {
        const result: unknown = await inner(work);
        order.push('commit');
        return result;
      });
      const events = publisher();
      events.publish.mockImplementation(() => {
        order.push('publish');
        return Promise.resolve();
      });
      const service = new DeadlineRemindersService(dataSource, config(60), events);

      await service.runOnce();

      expect(order).toEqual(['commit', 'publish']);

      expect(events.publish).toHaveBeenCalledTimes(1);
      const event = events.publish.mock.calls[0][0] as DomainEventOf<'notification.created'>;
      expect(event).toMatchObject({
        type: 'notification.created',
        boardId: 'board-1',
        origin: 'user',
        occurredAt: '2026-10-27T10:00:00.000Z',
        payload: {
          recipientId: 'bob',
          notification: { id: 'n0', type: 'deadline.reminder', readAt: null },
        },
      });
      expect(event.payload.notification.createdAt).toMatch(/Z$/);
      expect(event.actorId).toBeUndefined();
    });

    it('stores and publishes nothing when no card is due', async () => {
      const { dataSource, manager } = dataSourceClaiming([]);
      const events = publisher();
      const service = new DeadlineRemindersService(dataSource, config(60), events);

      await expect(service.runOnce()).resolves.toBe(0);
      expect(manager.save).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('publishes nothing when the transaction fails', async () => {
      const dataSource = {
        transaction: jest.fn().mockRejectedValue(new Error('database down')),
      } as unknown as DataSource;
      const events = publisher();
      const service = new DeadlineRemindersService(dataSource, config(60), events);

      await expect(service.runOnce()).rejects.toThrow('database down');
      expect(events.publish).not.toHaveBeenCalled();
    });
  });
});

describe('CardsService re-arms the reminder', () => {
  const access = {
    requireEditor: jest.fn().mockResolvedValue(BoardRole.MEMBER),
  } as unknown as BoardAccessService;
  const deadline = new Date('2026-10-28T09:00:00.000Z');

  function serviceFor(card: Partial<CardEntity>) {
    const stored = Object.assign(new CardEntity(), {
      id: 'c1',
      boardId: 'b',
      columnId: 'col',
      title: 'T',
      position: 0,
      labels: [],
      createdAt: NOW,
      updatedAt: NOW,
      ...card,
    });
    const cards = {
      findOne: jest.fn().mockResolvedValue(stored),
      save: jest.fn((entity: CardEntity) => Promise.resolve(entity)),
    } as unknown as Repository<CardEntity>;
    const dataSource = {
      getRepository: () => ({ findOne: jest.fn().mockResolvedValue({ userId: 'carol' }) }),
    } as unknown as DataSource;
    const service = new CardsService(
      dataSource,
      cards,
      {} as Repository<BoardColumnEntity>,
      access,
      publisher(),
    );
    return { service, stored };
  }

  it('clears reminderSentAt when the deadline changes', async () => {
    const { service, stored } = serviceFor({ deadline, reminderSentAt: NOW });
    await service.update('u', 'c1', { deadline: '2026-10-28T12:00:00.000Z' });
    expect(stored.reminderSentAt).toBeNull();
  });

  it('keeps reminderSentAt when the same deadline or only the title is sent', async () => {
    const { service, stored } = serviceFor({ deadline, reminderSentAt: NOW });
    await service.update('u', 'c1', { title: 'New', deadline: deadline.toISOString() });
    expect(stored.reminderSentAt).toBe(NOW);
  });

  it('clears reminderSentAt when the assignee changes, not when it stays', async () => {
    const same = serviceFor({ assigneeId: 'bob', reminderSentAt: NOW });
    await same.service.assign('u', 'c1', 'bob');
    expect(same.stored.reminderSentAt).toBe(NOW);

    const other = serviceFor({ assigneeId: 'bob', reminderSentAt: NOW });
    await other.service.assign('u', 'c1', 'carol');
    expect(other.stored.reminderSentAt).toBeNull();
  });
});
