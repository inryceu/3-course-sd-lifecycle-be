import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OutboxOperationError } from '../../../common/outbox/outbox.errors';
import { JiraOutboxAdminService } from './jira-outbox-admin.service';

const raw = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  sequence: '7',
  operation: 'TRANSITION_ISSUE',
  board_id: 'b1',
  card_id: 'c1',
  payload: { jiraIssueKey: 'KAN-1', targetColumnId: 'done' },
  status: 'DEAD',
  attempts: 3,
  error_code: 'jira_error',
  last_error: 'boom',
  available_at: new Date(0),
  created_at: new Date(1),
  updated_at: new Date(2),
  sent_at: null,
  dead_at: new Date(3),
  ...over,
});

function setup() {
  const dataSource = { query: jest.fn() };
  const outbox = { requeue: jest.fn() };
  const worker = { kick: jest.fn() };
  const statusMappings = { requireRole: jest.fn().mockResolvedValue(undefined) };
  const service = new JiraOutboxAdminService(
    dataSource as never,
    outbox as never,
    worker as never,
    statusMappings as never,
  );
  return { service, dataSource, outbox, worker, statusMappings };
}

describe('JiraOutboxAdminService', () => {
  describe('list', () => {
    it('requires an Admin and defaults to DEAD rows', async () => {
      const ctx = setup();
      ctx.dataSource.query.mockResolvedValue([]);
      await ctx.service.list('u1', 'b1');
      expect(ctx.statusMappings.requireRole).toHaveBeenCalledWith('u1', 'b1', true);
      expect(ctx.dataSource.query.mock.calls[0][1]).toEqual(['b1', 'DEAD', 51]);
    });

    it('does not query for a non-admin', async () => {
      const ctx = setup();
      ctx.statusMappings.requireRole.mockRejectedValue(new ForbiddenException());
      await expect(ctx.service.list('u1', 'b1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(ctx.dataSource.query).not.toHaveBeenCalled();
    });

    it('maps rows and returns the cursor when there is another page', async () => {
      const ctx = setup();
      ctx.dataSource.query.mockResolvedValue([raw('r1'), raw('r2'), raw('r3')]);
      const page = await ctx.service.list('u1', 'b1', 'PENDING', 2);
      expect(page.items.map((i) => i.id)).toEqual(['r1', 'r2']);
      expect(page.nextCursor).toBe('r2');
      expect(page.items[0]).toMatchObject({
        sequence: '7',
        jiraIssueKey: 'KAN-1',
        targetColumnId: 'done',
        errorCode: 'jira_error',
      });
    });

    it('adds the keyset condition for a cursor and has no next cursor on the last page', async () => {
      const ctx = setup();
      ctx.dataSource.query.mockResolvedValue([raw('r9', { payload: {} })]);
      const page = await ctx.service.list('u1', 'b1', 'DEAD', 50, 'r8');
      expect(ctx.dataSource.query.mock.calls[0][0]).toContain('created_at, id) <');
      expect(ctx.dataSource.query.mock.calls[0][1]).toEqual(['b1', 'DEAD', 51, 'r8']);
      expect(page.nextCursor).toBeNull();
      expect(page.items[0]).toMatchObject({ jiraIssueKey: null, targetColumnId: null });
    });
  });

  describe('requeue', () => {
    const entity = {
      id: 'r1',
      sequence: '7',
      operation: 'TRANSITION_ISSUE',
      boardId: 'b1',
      cardId: 'c1',
      payload: { jiraIssueKey: 'KAN-1', targetColumnId: 'done' },
      status: 'PENDING',
      attempts: 0,
      errorCode: null,
      lastError: null,
      availableAt: new Date(0),
      createdAt: new Date(1),
      updatedAt: new Date(2),
      sentAt: null,
      deadAt: null,
    };

    it('answers 404 for an unknown row without checking the role', async () => {
      const ctx = setup();
      ctx.dataSource.query.mockResolvedValue([]);
      await expect(ctx.service.requeue('u1', 'r1')).rejects.toBeInstanceOf(NotFoundException);
      expect(ctx.statusMappings.requireRole).not.toHaveBeenCalled();
    });

    it('requires an Admin of the row board', async () => {
      const ctx = setup();
      ctx.dataSource.query.mockResolvedValue([{ board_id: 'b1' }]);
      ctx.statusMappings.requireRole.mockRejectedValue(new ForbiddenException());
      await expect(ctx.service.requeue('u1', 'r1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(ctx.outbox.requeue).not.toHaveBeenCalled();
    });

    it('requeues, wakes the worker and returns the row', async () => {
      const ctx = setup();
      ctx.dataSource.query.mockResolvedValue([{ board_id: 'b1' }]);
      ctx.outbox.requeue.mockResolvedValue(entity);
      const view = await ctx.service.requeue('u1', 'r1');
      expect(view).toMatchObject({ id: 'r1', status: 'PENDING', attempts: 0 });
      expect(ctx.worker.kick).toHaveBeenCalled();
    });

    it('maps a refusal to 409 or 404 and rethrows anything else', async () => {
      const ctx = setup();
      ctx.dataSource.query.mockResolvedValue([{ board_id: 'b1' }]);
      ctx.outbox.requeue.mockRejectedValueOnce(
        new OutboxOperationError('not_dead', 'Row is not DEAD'),
      );
      await expect(ctx.service.requeue('u1', 'r1')).rejects.toBeInstanceOf(ConflictException);
      ctx.outbox.requeue.mockRejectedValueOnce(new OutboxOperationError('blocked', 'blocked'));
      await expect(ctx.service.requeue('u1', 'r1')).rejects.toBeInstanceOf(ConflictException);
      ctx.outbox.requeue.mockRejectedValueOnce(new OutboxOperationError('not_found', 'gone'));
      await expect(ctx.service.requeue('u1', 'r1')).rejects.toBeInstanceOf(NotFoundException);
      ctx.outbox.requeue.mockRejectedValueOnce(new Error('db down'));
      await expect(ctx.service.requeue('u1', 'r1')).rejects.toThrow('db down');
    });
  });

  describe('requeueDead', () => {
    it('requires an Admin', async () => {
      const ctx = setup();
      ctx.statusMappings.requireRole.mockRejectedValue(new ForbiddenException());
      await expect(ctx.service.requeueDead('u1', 'b1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(ctx.dataSource.query).not.toHaveBeenCalled();
    });

    it('requeues what it can, counts blocked rows as skipped and wakes the worker once', async () => {
      const ctx = setup();
      ctx.dataSource.query.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]);
      ctx.outbox.requeue
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new OutboxOperationError('blocked', 'blocked'))
        .mockResolvedValueOnce({});
      await expect(ctx.service.requeueDead('u1', 'b1')).resolves.toEqual({
        requeued: 2,
        skipped: 1,
      });
      expect(ctx.worker.kick).toHaveBeenCalledTimes(1);
    });

    it('does not wake the worker when nothing was requeued, and rethrows unexpected errors', async () => {
      const ctx = setup();
      ctx.dataSource.query.mockResolvedValue([]);
      await expect(ctx.service.requeueDead('u1', 'b1')).resolves.toEqual({
        requeued: 0,
        skipped: 0,
      });
      expect(ctx.worker.kick).not.toHaveBeenCalled();
      ctx.dataSource.query.mockResolvedValue([{ id: 'r1' }]);
      ctx.outbox.requeue.mockRejectedValue(new Error('db down'));
      await expect(ctx.service.requeueDead('u1', 'b1')).rejects.toThrow('db down');
    });
  });
});
