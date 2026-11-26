import { JiraConflictsController } from './jira-conflicts.controller';

describe('JiraConflictsController', () => {
  const service = {
    list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    resolve: jest.fn().mockResolvedValue({ id: 'c1' }),
  };
  const controller = new JiraConflictsController(service as never);

  it('lists with the board and paging of the query', async () => {
    await controller.list('u1', { boardId: 'b1', limit: 10, cursor: 'c0' });
    expect(service.list).toHaveBeenCalledWith('u1', 'b1', 10, 'c0');
  });

  it('resolves with the chosen resolution for the current user', async () => {
    await expect(controller.resolve('u1', 'c1', { resolution: 'boardsync' })).resolves.toEqual({
      id: 'c1',
    });
    expect(service.resolve).toHaveBeenCalledWith('u1', 'c1', 'boardsync');
  });
});
