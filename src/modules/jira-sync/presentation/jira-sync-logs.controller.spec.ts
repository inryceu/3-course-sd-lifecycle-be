import { JiraSyncLogsController } from './jira-sync-logs.controller';

describe('JiraSyncLogsController', () => {
  const service = { list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }) };
  const controller = new JiraSyncLogsController(service as never);

  it('lists with the board, paging and status filter of the query', async () => {
    await controller.list('u1', { boardId: 'b1', limit: 5, cursor: 'c0', status: 'FAILED' });
    expect(service.list).toHaveBeenCalledWith('u1', 'b1', 5, 'c0', 'FAILED');
  });
});
