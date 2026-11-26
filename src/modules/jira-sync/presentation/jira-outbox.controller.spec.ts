import { JiraOutboxController } from './jira-outbox.controller';

describe('JiraOutboxController', () => {
  const admin = {
    list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    requeue: jest.fn().mockResolvedValue({ id: 'o1' }),
    requeueDead: jest.fn().mockResolvedValue({ requeued: 2, skipped: 1 }),
  };
  const controller = new JiraOutboxController(admin as never);

  it('lists with the board, status and paging of the query', async () => {
    await controller.list('u1', { boardId: 'b1', status: 'PENDING', limit: 10, cursor: 'c1' });
    expect(admin.list).toHaveBeenCalledWith('u1', 'b1', 'PENDING', 10, 'c1');
  });

  it('requeues one row for the current user', async () => {
    await expect(controller.requeue('u1', 'o1')).resolves.toEqual({ id: 'o1' });
    expect(admin.requeue).toHaveBeenCalledWith('u1', 'o1');
  });

  it('requeues the dead rows of a board for the current user', async () => {
    await expect(controller.requeueDead('u1', { boardId: 'b1' })).resolves.toEqual({
      requeued: 2,
      skipped: 1,
    });
    expect(admin.requeueDead).toHaveBeenCalledWith('u1', 'b1');
  });
});
