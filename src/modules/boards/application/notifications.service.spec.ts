import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

const entity = (id: string, recipientId = 'u1') => ({
  id,
  recipientId,
  boardId: 'b1',
  type: 'jira.sync.failed',
  payload: { outboxId: 'o1' },
  readAt: null,
  createdAt: new Date('2026-11-26T10:00:00Z'),
});

function setup() {
  const notifications = {
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn((rows: Array<{ recipientId: string }>) =>
      Promise.resolve(rows.map((r, i) => entity(`n${i}`, r.recipientId))),
    ),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const memberships = { find: jest.fn(), exist: jest.fn() };
  const events = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationsService(
    notifications as never,
    memberships as never,
    events as never,
  );
  return { service, notifications, memberships, events };
}

describe('NotificationsService', () => {
  describe('notifyAdmins', () => {
    it('stores one notification per distinct Admin and publishes notification.created for each', async () => {
      const { service, notifications, memberships, events } = setup();
      memberships.find.mockResolvedValue([{ userId: 'a1' }, { userId: 'a2' }, { userId: 'a1' }]);

      const created = await service.notifyAdmins('b1', 'jira.sync.failed', { outboxId: 'o1' });

      expect(created).toBe(2);
      expect(notifications.create).toHaveBeenCalledTimes(2);
      expect(notifications.create).toHaveBeenCalledWith({
        recipientId: 'a1',
        boardId: 'b1',
        type: 'jira.sync.failed',
        payload: { outboxId: 'o1' },
        readAt: null,
      });
      expect(events.publish).toHaveBeenCalledTimes(2);
      expect(events.publish.mock.calls[0][0]).toMatchObject({
        type: 'notification.created',
        boardId: 'b1',
        payload: { recipientId: 'a1', notification: { id: 'n0', type: 'jira.sync.failed' } },
      });
    });

    it('creates nothing when the board has no Admin', async () => {
      const { service, notifications, memberships, events } = setup();
      memberships.find.mockResolvedValue([]);
      await expect(service.notifyAdmins('b1', 'jira.conflict', {})).resolves.toBe(0);
      expect(notifications.save).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });
  });

  describe('notifyUser', () => {
    it('notifies a member of the board', async () => {
      const { service, memberships, events } = setup();
      memberships.exist.mockResolvedValue(true);
      await expect(service.notifyUser('u1', 'b1', 'jira.sync.failed', {})).resolves.toBe(1);
      expect(memberships.exist).toHaveBeenCalledWith({ where: { boardId: 'b1', userId: 'u1' } });
      expect(events.publish.mock.calls[0][0]).toMatchObject({
        payload: { recipientId: 'u1' },
      });
    });

    it('notifies nobody who is not (or no longer) a member', async () => {
      const { service, memberships, notifications } = setup();
      memberships.exist.mockResolvedValue(false);
      await expect(service.notifyUser('u1', 'b1', 'jira.sync.failed', {})).resolves.toBe(0);
      expect(notifications.save).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    const query = (rows: unknown[]) => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      };
      return qb;
    };

    it('returns a page with the id of the last item as the next cursor', async () => {
      const { service, notifications } = setup();
      const qb = query([entity('n1'), entity('n2'), entity('n3')]);
      notifications.createQueryBuilder.mockReturnValue(qb);
      const page = await service.list('u1', 2);
      expect(page.items.map((i) => i.id)).toEqual(['n1', 'n2']);
      expect(page.nextCursor).toBe('n2');
      expect(qb.limit).toHaveBeenCalledWith(3);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('continues after a cursor and ends with a null cursor on the last page', async () => {
      const { service, notifications } = setup();
      const qb = query([entity('n3')]);
      notifications.createQueryBuilder.mockReturnValue(qb);
      const page = await service.list('u1', 50, 'n2');
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('createdAt'), {
        cursor: 'n2',
      });
      expect(page).toMatchObject({ items: [{ id: 'n3' }], nextCursor: null });
    });
  });

  describe('markRead', () => {
    const updateBuilder = () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      };
      return qb;
    };

    it('marks the notification read and returns it', async () => {
      const { service, notifications } = setup();
      const qb = updateBuilder();
      notifications.createQueryBuilder.mockReturnValue(qb);
      notifications.findOne.mockResolvedValue(entity('n1'));
      await expect(service.markRead('u1', 'n1')).resolves.toMatchObject({ id: 'n1' });
      expect(qb.where).toHaveBeenCalledWith('id = :notificationId AND recipient_id = :userId', {
        notificationId: 'n1',
        userId: 'u1',
      });
    });

    it("answers 404 for another user's or an unknown notification", async () => {
      const { service, notifications } = setup();
      notifications.createQueryBuilder.mockReturnValue(updateBuilder());
      notifications.findOne.mockResolvedValue(null);
      await expect(service.markRead('u1', 'n9')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
