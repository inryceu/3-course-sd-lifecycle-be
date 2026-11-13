import { createHash } from 'crypto';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JiraWebhookService } from './jira-webhook.service';

const BODY = {
  webhookEvent: 'jira:issue_updated',
  timestamp: 1_700_000_000_000,
  issue: {
    id: '10001',
    self: 'https://team.atlassian.net/rest/api/2/issue/10001',
    key: 'KAN-7',
    fields: {
      status: {
        id: '3',
        name: 'Done',
        statusCategory: { id: 3, key: 'done', name: 'Done' },
      },
    },
  },
  changelog: { id: '90001', items: [{ field: 'status' }] },
};

const RAW = Buffer.from(JSON.stringify(BODY));
const HEADERS = { 'x-atlassian-webhook-identifier': 'delivery-1' };
const KEY = createHash('sha256').update('jira:issue_updated|10001|90001').digest('hex');
const DONE_STATUS = {
  id: '3',
  name: 'Done',
  statusCategory: { id: 3, key: 'done', name: 'Done' },
};
const BOARD = { id: 'board-1', jiraProjectKey: 'KAN', columns: [{ id: 'col-done' }] };
const LINK = {
  id: 'link-1',
  boardId: 'board-1',
  cardId: 'card-1',
  jiraIssueKey: 'KAN-7',
  jiraProjectKey: 'KAN',
};

function setup() {
  const authenticity = { verify: jest.fn() };
  const deliveries = {
    claim: jest.fn().mockResolvedValue(true),
    complete: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const statusMappings = {
    columnsByStatus: jest.fn().mockResolvedValue(new Map([['3', 'col-done']])),
  };
  const links = {
    find: jest.fn().mockResolvedValue([LINK]),
    // advanceWatermark returns the previous value; restoreWatermark returns nothing useful.
    query: jest.fn().mockResolvedValue([{ previous: null }]),
  };
  const connections = {
    find: jest
      .fn()
      .mockResolvedValue([
        { boardId: 'board-1', cloudId: 'cloud-1', siteUrl: 'https://team.atlassian.net' },
      ]),
  };
  const boards = {
    getBoardSummary: jest.fn().mockResolvedValue(BOARD),
    moveCardFromExternal: jest.fn().mockResolvedValue('moved'),
  };
  const service = new JiraWebhookService(
    authenticity as never,
    deliveries as never,
    statusMappings as never,
    links as never,
    connections as never,
    boards as never,
  );
  return { service, authenticity, deliveries, statusMappings, links, connections, boards };
}

describe('JiraWebhookService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('verifies, claims, moves the card and completes the delivery', async () => {
    const ctx = setup();

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.authenticity.verify).toHaveBeenCalledWith(RAW, HEADERS);
    expect(ctx.deliveries.claim).toHaveBeenCalledWith(KEY);
    expect(ctx.statusMappings.columnsByStatus).toHaveBeenCalledWith(
      { board: BOARD, projectKey: 'KAN' },
      [DONE_STATUS],
    );
    expect(ctx.boards.moveCardFromExternal).toHaveBeenCalledWith({
      boardId: 'board-1',
      jiraIssueKey: 'KAN-7',
      columnId: 'col-done',
    });
    expect(ctx.deliveries.complete).toHaveBeenCalledWith(KEY);
    expect(ctx.deliveries.release).not.toHaveBeenCalled();
  });

  it('does not publish a second move for a duplicate delivery', async () => {
    const ctx = setup();
    ctx.deliveries.claim.mockResolvedValue(false);

    await expect(ctx.service.receive(RAW, BODY, HEADERS)).resolves.toBeUndefined();

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).not.toHaveBeenCalled();
    expect(ctx.deliveries.release).not.toHaveBeenCalled();
  });

  it('accepts and completes an unrelated event without moving cards', async () => {
    const ctx = setup();

    await ctx.service.receive(RAW, { ...BODY, webhookEvent: 'jira:issue_created' }, HEADERS);

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('completes without moving when the issue is unknown', async () => {
    const ctx = setup();
    ctx.links.find.mockResolvedValue([]);

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('completes without moving when the mapping has no card', async () => {
    const ctx = setup();
    ctx.links.find.mockResolvedValue([{ ...LINK, cardId: null }]);

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('completes without moving when the board no longer exists', async () => {
    const ctx = setup();
    ctx.boards.getBoardSummary.mockResolvedValue(null);

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('looks the card up only on boards connected to the sending site', async () => {
    const ctx = setup();
    ctx.connections.find.mockResolvedValue([
      { boardId: 'board-1', cloudId: 'cloud-1', siteUrl: 'https://team.atlassian.net' },
      { boardId: 'board-2', cloudId: 'cloud-2', siteUrl: 'https://other.atlassian.net' },
      { boardId: 'board-3', cloudId: 'cloud-3', siteUrl: 'https://third.atlassian.net' },
    ]);
    const viaApi = {
      ...BODY,
      issue: {
        ...BODY.issue,
        self: 'https://api.atlassian.com/ex/jira/cloud-3/rest/api/2/issue/10001',
      },
    };

    await ctx.service.receive(RAW, BODY, HEADERS);
    await ctx.service.receive(RAW, viaApi, HEADERS);

    const boardIds = ctx.links.find.mock.calls.map(
      ([options]) => (options as { where: { boardId: { value: string[] } } }).where.boardId.value,
    );
    expect(boardIds).toEqual([['board-1'], ['board-3']]);
  });

  it('ignores a delivery from a site no board is connected to', async () => {
    const ctx = setup();
    ctx.connections.find.mockResolvedValue([]);

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.links.find).not.toHaveBeenCalled();
    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('does not move a card on a board relinked to another project', async () => {
    const ctx = setup();
    ctx.boards.getBoardSummary.mockResolvedValue({ ...BOARD, jiraProjectKey: 'OTHER' });

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('drops a delivery that is not newer than the last applied one', async () => {
    const ctx = setup();
    ctx.links.query.mockResolvedValue([]);

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.links.query.mock.calls[0][1]).toEqual(['link-1', '1700000000000']);
    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('gives the watermark back when the move fails', async () => {
    const ctx = setup();
    ctx.links.query.mockResolvedValueOnce([{ previous: '1600000000000' }]);
    ctx.boards.moveCardFromExternal.mockRejectedValue(new Error('database down'));

    await expect(ctx.service.receive(RAW, BODY, HEADERS)).rejects.toThrow('database down');

    expect(ctx.links.query).toHaveBeenLastCalledWith(
      expect.stringContaining('SET last_jira_event_at = $3'),
      ['link-1', '1700000000000', '1600000000000'],
    );
  });

  it('releases the claim when the move fails', async () => {
    const ctx = setup();
    ctx.boards.moveCardFromExternal.mockRejectedValue(new Error('database down'));

    await expect(ctx.service.receive(RAW, BODY, HEADERS)).rejects.toThrow('database down');

    expect(ctx.deliveries.complete).not.toHaveBeenCalled();
    expect(ctx.deliveries.release).toHaveBeenCalledWith(KEY);
  });

  it('releases the claim when a failure happens between claim and move', async () => {
    const ctx = setup();
    ctx.statusMappings.columnsByStatus.mockRejectedValue(new Error('board lookup failed'));

    await expect(ctx.service.receive(RAW, BODY, HEADERS)).rejects.toThrow('board lookup failed');

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.release).toHaveBeenCalledWith(KEY);
  });

  it('does not claim anything when authenticity fails', async () => {
    const ctx = setup();
    ctx.authenticity.verify.mockImplementation(() => {
      throw new UnauthorizedException();
    });

    await expect(ctx.service.receive(RAW, BODY, HEADERS)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(ctx.deliveries.claim).not.toHaveBeenCalled();
  });

  it('remains retryable after a failed move', async () => {
    const ctx = setup();
    ctx.boards.moveCardFromExternal
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('moved');

    await expect(ctx.service.receive(RAW, BODY, HEADERS)).rejects.toThrow('temporary');
    await expect(ctx.service.receive(RAW, BODY, HEADERS)).resolves.toBeUndefined();

    expect(ctx.deliveries.release).toHaveBeenCalledTimes(1);
    expect(ctx.deliveries.complete).toHaveBeenCalledTimes(1);
    expect(ctx.boards.moveCardFromExternal).toHaveBeenCalledTimes(2);
  });

  it('derives the same delivery key for a replay with a different identifier header', async () => {
    const ctx = setup();

    await ctx.service.receive(RAW, BODY, { 'x-atlassian-webhook-identifier': 'delivery-1' });
    await ctx.service.receive(RAW, BODY, { 'x-atlassian-webhook-identifier': 'replayed-2' });

    const [first, second] = ctx.deliveries.claim.mock.calls.map(([key]) => key as string);
    expect(second).toBe(first);
  });

  it('names the board in the receive log line', async () => {
    const ctx = setup();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('board-1'));
  });

  it('uses the status snapshot from the payload regardless of delivery order', async () => {
    const ctx = setup();
    const outOfOrder = {
      ...BODY,
      issue: {
        ...BODY.issue,
        fields: {
          status: {
            id: '5',
            name: 'To Do',
            statusCategory: { id: 2, key: 'new', name: 'To Do' },
          },
        },
      },
      changelog: {
        id: '90002',
        items: [{ field: 'status', fromString: 'Done', toString: 'To Do' }],
      },
    };

    await ctx.service.receive(RAW, outOfOrder, {
      'x-atlassian-webhook-identifier': 'delivery-2',
    });

    expect(ctx.statusMappings.columnsByStatus).toHaveBeenCalledWith(expect.anything(), [
      { id: '5', name: 'To Do', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
    ]);
  });
});
