import { Logger } from '@nestjs/common';
import { JiraWebhookLifecycleService } from './jira-webhook-lifecycle.service';

const NOW = new Date('2026-11-05T10:00:00Z');
const URL = 'https://app.example.com/api/v1/jira/webhook';

function monthsBefore(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

function setup(options: { nodeEnv?: string; url?: string } = {}) {
  const query = jest.fn().mockResolvedValue([{ locked: true }]);
  const runner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query,
  };
  const webhooks = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const connections = {
    exist: jest.fn().mockResolvedValue(true),
    find: jest.fn().mockResolvedValue([]),
  };
  const boards = {
    getBoardSummary: jest
      .fn()
      .mockResolvedValue({ jiraProjectKey: 'KAN', columns: [{ id: 'col', type: 'todo' }] }),
  };
  const gateway = {
    registerWebhook: jest.fn().mockResolvedValue({
      webhookRegistrationResult: [{ createdWebhookId: 42 }],
    }),
    listWebhooks: jest.fn().mockResolvedValue({
      values: [{ id: 42, expirationDate: '2026-12-05T10:00:00.000Z' }],
    }),
    refreshWebhooks: jest.fn().mockResolvedValue({
      expirationDate: '2026-12-05T10:00:00.000Z',
    }),
  };
  const deliveries = { deleteExpired: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'jira.webhookUrl') return options.url === undefined ? URL : options.url;
      if (key === 'app.nodeEnv') return options.nodeEnv ?? 'test';
      return undefined;
    }),
  };
  const dataSource = { createQueryRunner: jest.fn(() => runner) };
  const service = new JiraWebhookLifecycleService(
    webhooks as never,
    connections as never,
    boards as never,
    gateway as never,
    deliveries as never,
    config as never,
    dataSource as never,
  );
  return { service, webhooks, connections, boards, gateway, deliveries, runner, query };
}

describe('JiraWebhookLifecycleService registration', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers a project webhook and persists the listed expiration', async () => {
    const { service, webhooks, gateway } = setup();

    await expect(service.registerForBoard('board-1', { now: NOW })).resolves.toBe(true);

    expect(gateway.registerWebhook).toHaveBeenCalledWith({
      boardId: 'board-1',
      url: URL,
      webhooks: [{ events: ['jira:issue_updated'], jqlFilter: 'project = "KAN"' }],
    });
    expect(gateway.listWebhooks).toHaveBeenCalledWith({ boardId: 'board-1', maxResults: 100 });
    expect(webhooks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 'board-1',
        projectKey: 'KAN',
        webhookId: 42,
        url: URL,
        jqlFilter: 'project = "KAN"',
        expiresAt: new Date('2026-12-05T10:00:00.000Z'),
      }),
      ['boardId'],
    );
  });

  it('falls back to now + 30 days when the expiration lookup fails', async () => {
    const { service, gateway, webhooks } = setup();
    gateway.listWebhooks.mockRejectedValue(new Error('list unavailable'));

    await expect(service.registerForBoard('board-1', { now: NOW })).resolves.toBe(true);

    expect(webhooks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
      }),
      ['boardId'],
    );
  });

  it('skips a board without a project key', async () => {
    const { service, boards, gateway } = setup();
    boards.getBoardSummary.mockResolvedValue({ jiraProjectKey: null, columns: [] });

    await expect(service.registerForBoard('board-1', { now: NOW })).resolves.toBe(false);

    expect(gateway.registerWebhook).not.toHaveBeenCalled();
  });

  it('skips a board without a Jira connection', async () => {
    const { service, connections, gateway } = setup();
    connections.exist.mockResolvedValue(false);

    await expect(service.registerForBoard('board-1', { now: NOW })).resolves.toBe(false);

    expect(gateway.registerWebhook).not.toHaveBeenCalled();
  });

  it('skips registration when JIRA_WEBHOOK_URL is unset', async () => {
    const { service, gateway } = setup({ url: '' });

    await expect(service.registerForBoard('board-1', { now: NOW })).resolves.toBe(false);

    expect(gateway.registerWebhook).not.toHaveBeenCalled();
  });

  it('does not fail the caller when Jira rejects registration', async () => {
    const { service, gateway, webhooks } = setup();
    gateway.registerWebhook.mockRejectedValue(new Error('missing_scope'));

    await expect(service.registerForBoard('board-1', { now: NOW })).resolves.toBe(false);

    expect(webhooks.upsert).not.toHaveBeenCalled();
  });

  it('does not register twice when the stored key and URL match', async () => {
    const { service, webhooks, gateway } = setup();
    webhooks.findOne.mockResolvedValue({ projectKey: 'KAN', url: URL });

    await expect(service.registerForBoard('board-1', { now: NOW })).resolves.toBe(false);

    expect(gateway.registerWebhook).not.toHaveBeenCalled();
  });
});

describe('JiraWebhookLifecycleService sweep', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('refreshes a webhook expiring within seven days', async () => {
    const { service, webhooks, gateway, query } = setup();
    webhooks.find.mockResolvedValue([
      {
        id: 'row-1',
        boardId: 'board-1',
        webhookId: 42,
        expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      },
    ]);

    const result = await service.sweep(NOW);

    expect(result).toEqual({ acquired: true, refreshed: 1, replaced: 0, registered: 0 });
    expect(gateway.refreshWebhooks).toHaveBeenCalledWith({ boardId: 'board-1', webhookIds: [42] });
    expect(webhooks.update).toHaveBeenCalledWith(
      { id: 'row-1' },
      {
        expiresAt: new Date('2026-12-05T10:00:00.000Z'),
        lastRefreshedAt: NOW,
      },
    );
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [742_026_001]);
  });

  it('refreshes a webhook already expired within the three-month grace period', async () => {
    const { service, webhooks, gateway } = setup();
    webhooks.find.mockResolvedValue([
      { id: 'row-1', boardId: 'board-1', webhookId: 42, expiresAt: monthsBefore(NOW, 2) },
    ]);

    const result = await service.sweep(NOW);

    expect(result.refreshed).toBe(1);
    expect(gateway.refreshWebhooks).toHaveBeenCalled();
    expect(gateway.registerWebhook).not.toHaveBeenCalled();
  });

  it('re-registers a webhook expired beyond the three-month grace period', async () => {
    const { service, webhooks } = setup();
    webhooks.find.mockResolvedValue([
      { id: 'row-1', boardId: 'board-1', webhookId: 42, expiresAt: monthsBefore(NOW, 4) },
    ]);
    const register = jest.spyOn(service, 'registerForBoard').mockResolvedValue(true);

    const result = await service.sweep(NOW);

    expect(result.replaced).toBe(1);
    expect(register).toHaveBeenCalledWith('board-1', { force: true, now: NOW });
  });

  it('does not refresh a webhook far from expiry', async () => {
    const { service, webhooks, gateway } = setup();
    webhooks.find.mockResolvedValue([
      {
        id: 'row-1',
        boardId: 'board-1',
        webhookId: 42,
        expiresAt: new Date(NOW.getTime() + 20 * 24 * 60 * 60 * 1000),
      },
    ]);

    const result = await service.sweep(NOW);

    expect(result.refreshed).toBe(0);
    expect(gateway.refreshWebhooks).not.toHaveBeenCalled();
  });

  it('leaves the row untouched when refresh fails and retries on the next sweep', async () => {
    const { service, webhooks, gateway } = setup();
    webhooks.find.mockResolvedValue([
      {
        id: 'row-1',
        boardId: 'board-1',
        webhookId: 42,
        expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      },
    ]);
    gateway.refreshWebhooks.mockRejectedValue(new Error('temporary'));

    const result = await service.sweep(NOW);

    expect(result.refreshed).toBe(0);
    expect(webhooks.update).not.toHaveBeenCalled();
  });

  it('registers a missing webhook for a connected and linked board', async () => {
    const { service, connections, boards } = setup();
    connections.find.mockResolvedValue([{ boardId: 'board-1' }]);
    boards.getBoardSummary.mockResolvedValue({ jiraProjectKey: 'KAN', columns: [] });
    const register = jest.spyOn(service, 'registerForBoard').mockResolvedValue(true);

    const result = await service.sweep(NOW);

    expect(result.registered).toBe(1);
    expect(register).toHaveBeenCalledWith('board-1', { now: NOW });
  });

  it('does nothing when another runner holds the advisory lock', async () => {
    const { service, query, webhooks, connections } = setup();
    query.mockResolvedValue([{ locked: false }]);

    await expect(service.sweep(NOW)).resolves.toEqual({
      acquired: false,
      refreshed: 0,
      replaced: 0,
      registered: 0,
    });
    expect(webhooks.find).not.toHaveBeenCalled();
    expect(connections.find).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not start a timer under NODE_ENV=test', () => {
    const { service } = setup({ nodeEnv: 'test' });
    const sweep = jest.spyOn(service, 'sweep').mockResolvedValue({
      acquired: true,
      refreshed: 0,
      replaced: 0,
      registered: 0,
    });
    const interval = jest.spyOn(global, 'setInterval');

    service.onModuleInit();

    expect(interval).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
    interval.mockRestore();
  });

  it('starts an unref’d six-hour timer outside tests and clears it on shutdown', () => {
    const { service } = setup({ nodeEnv: 'development' });
    jest.spyOn(service, 'sweep').mockResolvedValue({
      acquired: true,
      refreshed: 0,
      replaced: 0,
      registered: 0,
    });
    const unref = jest.fn();
    const timer = { unref } as unknown as NodeJS.Timeout;
    const interval = jest.spyOn(global, 'setInterval').mockReturnValue(timer);
    const clear = jest.spyOn(global, 'clearInterval').mockImplementation();

    service.onModuleInit();

    expect(interval).toHaveBeenCalledWith(expect.any(Function), 6 * 60 * 60 * 1000);
    expect(unref).toHaveBeenCalled();
    service.onModuleDestroy();
    expect(clear).toHaveBeenCalledWith(timer);
    interval.mockRestore();
    clear.mockRestore();
  });
});
