import { Logger, UnauthorizedException } from '@nestjs/common';
import { JiraWebhookService } from './jira-webhook.service';

const BODY = {
  webhookEvent: 'jira:issue_updated',
  timestamp: 1_700_000_000_000,
  issue: {
    id: '10001',
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

function setup() {
  const authenticity = { verify: jest.fn() };
  const deliveries = {
    claim: jest.fn().mockResolvedValue(true),
    complete: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const statusMappings = {
    columnForStatus: jest.fn().mockResolvedValue('col-done'),
  };
  const links = {
    findOne: jest.fn().mockResolvedValue({ boardId: 'board-1', cardId: 'card-1' }),
  };
  const boards = {
    moveCardFromExternal: jest.fn().mockResolvedValue('moved'),
  };
  const service = new JiraWebhookService(
    authenticity as never,
    deliveries as never,
    statusMappings as never,
    links as never,
    boards as never,
  );
  return { service, authenticity, deliveries, statusMappings, links, boards };
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
    expect(ctx.deliveries.claim).toHaveBeenCalledWith('delivery-1');
    expect(ctx.statusMappings.columnForStatus).toHaveBeenCalledWith('board-1', {
      id: '3',
      name: 'Done',
      categoryKey: 'done',
    });
    expect(ctx.boards.moveCardFromExternal).toHaveBeenCalledWith({
      boardId: 'board-1',
      jiraIssueKey: 'KAN-7',
      columnId: 'col-done',
    });
    expect(ctx.deliveries.complete).toHaveBeenCalledWith('delivery-1');
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
    expect(ctx.deliveries.complete).toHaveBeenCalledWith('delivery-1');
  });

  it('completes without moving when the issue is unknown', async () => {
    const ctx = setup();
    ctx.links.findOne.mockResolvedValue(null);

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('completes without moving when the mapping has no card', async () => {
    const ctx = setup();
    ctx.links.findOne.mockResolvedValue({ boardId: 'board-1', cardId: null });

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('completes without moving when the board has no target column', async () => {
    const ctx = setup();
    ctx.statusMappings.columnForStatus.mockResolvedValue(null);

    await ctx.service.receive(RAW, BODY, HEADERS);

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.complete).toHaveBeenCalled();
  });

  it('releases the claim when the move fails', async () => {
    const ctx = setup();
    ctx.boards.moveCardFromExternal.mockRejectedValue(new Error('database down'));

    await expect(ctx.service.receive(RAW, BODY, HEADERS)).rejects.toThrow('database down');

    expect(ctx.deliveries.complete).not.toHaveBeenCalled();
    expect(ctx.deliveries.release).toHaveBeenCalledWith('delivery-1');
  });

  it('releases the claim when a failure happens between claim and move', async () => {
    const ctx = setup();
    ctx.statusMappings.columnForStatus.mockRejectedValue(new Error('board lookup failed'));

    await expect(ctx.service.receive(RAW, BODY, HEADERS)).rejects.toThrow('board lookup failed');

    expect(ctx.boards.moveCardFromExternal).not.toHaveBeenCalled();
    expect(ctx.deliveries.release).toHaveBeenCalledWith('delivery-1');
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

    expect(ctx.statusMappings.columnForStatus).toHaveBeenCalledWith('board-1', {
      id: '5',
      name: 'To Do',
      categoryKey: 'new',
    });
  });
});
