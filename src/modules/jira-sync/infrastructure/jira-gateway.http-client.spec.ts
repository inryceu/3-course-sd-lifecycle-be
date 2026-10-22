import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AtlassianOAuth, AtlassianTokens } from '../application/atlassian-oauth.port';
import { DEFAULT_SEARCH_FIELDS, JiraComment, JiraIssue } from '../application/jira-gateway.port';
import { plainTextToAdf } from '../application/helpers/plain-text-to-adf';
import { TokenCipher } from '../application/token-cipher.port';
import { AtlassianRejectedError, AtlassianUnavailableError } from '../domain/errors';
import {
  JiraClientError,
  JiraPersistenceError,
  JiraRateLimitedError,
  JiraServerError,
  JiraTimeBudgetExceededError,
  JiraTimeoutError,
  JiraUnauthorizedError,
} from '../domain/jira-gateway.errors';
import { JiraConnectionEntity } from './persistence/jira-connection.entity';
import { JiraGatewayHttpClient } from './jira-gateway.http-client';

interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

interface ResponseSpec {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Responder = (request: Recorded) => ResponseSpec;

interface FakeConnection {
  boardId: string;
  cloudId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date;
}

const BOARD = 'board-1';
const CLOUD = 'cloud-1';
const BASE_NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const cipher: TokenCipher = {
  encrypt: (plaintext) => `enc(${plaintext})`,
  decrypt: (stored) => stored.replace(/^enc\((.*)\)$/, '$1'),
};

let server: Server;
let baseUrl: string;
let requests: Recorded[];
let respond: Responder;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const recorded: Recorded = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);
      const { status, body, headers } = respond(recorded);
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  requests = [];
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

function makeConnection(overrides: Partial<FakeConnection> = {}): FakeConnection {
  return {
    boardId: BOARD,
    cloudId: CLOUD,
    accessTokenEnc: 'enc(access-1)',
    refreshTokenEnc: 'enc(refresh-1)',
    expiresAt: new Date(BASE_NOW + HOUR),
    ...overrides,
  };
}

interface SetupOptions {
  connection?: FakeConnection | null;
  now?: number;
  timeoutMs?: number;
  timeBudgetMs?: number;
  random?: () => number;
}

function setup(options: SetupOptions = {}) {
  let nowValue = options.now ?? BASE_NOW;
  const state: { connection: FakeConnection | null } = {
    connection: options.connection === null ? null : { ...makeConnection(options.connection) },
  };
  const findOne = jest.fn(() =>
    Promise.resolve(state.connection === null ? null : { ...state.connection }),
  );
  const update = jest.fn((criteria: Partial<FakeConnection>, patch: Partial<FakeConnection>) => {
    if (state.connection === null) {
      return Promise.resolve({ affected: 0 });
    }
    const matches = Object.entries(criteria).every(
      ([key, value]) => (state.connection as unknown as Record<string, unknown>)[key] === value,
    );
    if (!matches) {
      return Promise.resolve({ affected: 0 });
    }
    Object.assign(state.connection, patch);
    return Promise.resolve({ affected: 1 });
  });
  const atlassian: jest.Mocked<AtlassianOAuth> = {
    exchangeCode: jest.fn(),
    refreshAccessToken: jest.fn(),
    listAccessibleResources: jest.fn(),
  };
  const sleep = jest.fn((ms: number) => {
    nowValue += ms;
    return Promise.resolve();
  });
  const values: Record<string, string> = {
    'jira.apiBaseUrl': baseUrl,
    'jira.authBaseUrl': baseUrl,
  };
  const client = new JiraGatewayHttpClient(
    { getOrThrow: (key: string) => values[key] } as never,
    cipher,
    { findOne, update } as unknown as Repository<JiraConnectionEntity>,
    atlassian,
    {
      now: () => nowValue,
      sleep,
      random: options.random ?? (() => 0.5),
      timeoutMs: options.timeoutMs,
      timeBudgetMs: options.timeBudgetMs,
    },
  );
  return {
    client,
    state,
    findOne,
    update,
    atlassian,
    sleep,
    now: () => nowValue,
  };
}

const ISSUE: JiraIssue = {
  id: '10001',
  key: 'KAN-1',
  self: 'https://example.test/rest/api/3/issue/10001',
  fields: {
    summary: 'Fix it',
    status: {
      id: '1',
      name: 'To Do',
      statusCategory: { id: 2, key: 'new', name: 'To Do' },
    },
    assignee: null,
    reporter: null,
    created: '2026-10-01T10:00:00.000Z',
    updated: '2026-10-02T10:00:00.000Z',
  },
};

const COMMENT: JiraComment = {
  id: '20001',
  self: 'https://example.test/rest/api/3/issue/10001/comment/20001',
  author: { accountId: 'user-1', displayName: 'User', active: true },
  body: plainTextToAdf('hello'),
  created: '2026-10-01T10:00:00.000Z',
  updated: '2026-10-01T10:00:00.000Z',
};

const NEW_TOKENS: AtlassianTokens = {
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
  expiresIn: 3600,
  scopes: ['read:jira-work', 'offline_access'],
};

function query(request: Recorded): URLSearchParams {
  return new URL(request.url, 'http://localhost').searchParams;
}

describe('JiraGatewayHttpClient.searchIssues', () => {
  it('merges the default fields with caller fields and sends the query', async () => {
    respond = () => ({
      status: 200,
      body: { issues: [ISSUE], nextPageToken: 'next-token', isLast: false },
    });
    const { client } = setup();

    const result = await client.searchIssues({
      boardId: BOARD,
      jql: 'project = KAN',
      fields: ['labels', 'summary'],
      expand: ['renderedFields'],
      maxResults: 25,
    });

    expect(result).toEqual({
      issues: [ISSUE],
      nextPageToken: 'next-token',
      isLast: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url.startsWith(`/ex/jira/${CLOUD}/rest/api/3/search/jql?`)).toBe(true);
    const params = query(requests[0]);
    expect(params.get('jql')).toBe('project = KAN');
    expect(params.get('maxResults')).toBe('25');
    expect(params.get('expand')).toBe('renderedFields');
    const fields = (params.get('fields') ?? '').split(',');
    for (const field of DEFAULT_SEARCH_FIELDS) {
      expect(fields).toContain(field);
    }
    expect(fields).toContain('labels');
    expect(fields.filter((field) => field === 'summary')).toHaveLength(1);
    expect(requests[0].headers.authorization).toBe('Bearer access-1');
  });

  it('sends the default fields when the caller omits fields', async () => {
    respond = () => ({ status: 200, body: { issues: [] } });
    const { client } = setup();

    await client.searchIssues({ boardId: BOARD, jql: 'project = KAN' });

    expect(query(requests[0]).get('fields')).toBe(DEFAULT_SEARCH_FIELDS.join(','));
  });

  it('defaults an empty response to no issues and no next page', async () => {
    respond = () => ({ status: 200, body: {} });
    const { client } = setup();
    await expect(client.searchIssues({ boardId: BOARD, jql: 'project = KAN' })).resolves.toEqual({
      issues: [],
      nextPageToken: null,
      isLast: false,
    });
  });

  it('maps a 400 response to JiraClientError', async () => {
    respond = () => ({
      status: 400,
      body: { errorMessages: ['bad jql'], errors: { jql: 'invalid' } },
    });
    const { client } = setup();
    const failure = client.searchIssues({ boardId: BOARD, jql: 'nope' });
    await expect(failure).rejects.toBeInstanceOf(JiraClientError);
    await expect(failure).rejects.toMatchObject({
      status: 400,
      providerError: 'bad jql',
      errorMessages: ['bad jql'],
      fieldErrors: { jql: 'invalid' },
    });
  });
});

describe('JiraGatewayHttpClient transitions and comments', () => {
  it('lists transitions with filters', async () => {
    respond = () => ({
      status: 200,
      body: {
        transitions: [
          {
            id: '31',
            name: 'Done',
            to: ISSUE.fields.status,
            hasScreen: false,
            isGlobal: true,
            isInitial: false,
            isConditional: false,
            isAvailable: true,
          },
        ],
      },
    });
    const { client } = setup();

    const result = await client.listTransitions({
      boardId: BOARD,
      issueIdOrKey: 'KAN-1',
      expand: 'transitions.fields',
      transitionId: '31',
      includeUnavailableTransitions: true,
    });

    expect(result.transitions).toHaveLength(1);
    expect(requests[0].url).toContain('/issue/KAN-1/transitions?');
    expect(query(requests[0]).get('expand')).toBe('transitions.fields');
    expect(query(requests[0]).get('transitionId')).toBe('31');
    expect(query(requests[0]).get('includeUnavailableTransitions')).toBe('true');
  });

  it('maps a missing issue or transition to JiraClientError', async () => {
    respond = () => ({ status: 404, body: { errorMessages: ['Issue does not exist'] } });
    const { client } = setup();

    const failure = client.listTransitions({ boardId: BOARD, issueIdOrKey: 'KAN-404' });
    await expect(failure).rejects.toBeInstanceOf(JiraClientError);
    await expect(failure).rejects.toMatchObject({
      status: 404,
      providerError: 'Issue does not exist',
    });
  });

  it('returns an empty transition list when no transition is available', async () => {
    respond = () => ({ status: 200, body: { transitions: [] } });
    const { client } = setup();

    await expect(
      client.listTransitions({ boardId: BOARD, issueIdOrKey: 'KAN-1' }),
    ).resolves.toEqual({ transitions: [] });
  });

  it('executes a transition and accepts only 204', async () => {
    respond = () => ({ status: 204 });
    const { client } = setup();

    await client.doTransition({
      boardId: BOARD,
      issueIdOrKey: 'KAN-1',
      transitionId: '31',
      fields: { resolution: { id: '10000' } },
    });

    expect(requests[0].method).toBe('POST');
    expect(requests[0].headers.authorization).toBe('Bearer access-1');
    expect(JSON.parse(requests[0].body)).toEqual({
      transition: { id: '31' },
      fields: { resolution: { id: '10000' } },
    });
  });

  it('rejects a 200 response where the transition endpoint must return 204', async () => {
    respond = () => ({ status: 200, body: { ok: true } });
    const { client } = setup();
    const failure = client.doTransition({
      boardId: BOARD,
      issueIdOrKey: 'KAN-1',
      transitionId: '31',
    });
    await expect(failure).rejects.toBeInstanceOf(JiraClientError);
    await expect(failure).rejects.toMatchObject({
      status: 200,
      providerError: 'unexpected_status',
    });
  });

  it('lists and adds comments', async () => {
    respond = (request) =>
      request.method === 'GET'
        ? {
            status: 200,
            body: { comments: [COMMENT], startAt: 0, maxResults: 50, total: 1 },
          }
        : { status: 201, body: COMMENT };
    const { client } = setup();

    const page = await client.getComments({
      boardId: BOARD,
      issueIdOrKey: 'KAN-1',
      startAt: 0,
      maxResults: 50,
      orderBy: 'created',
      expand: 'renderedBody',
    });
    expect(page).toEqual({ comments: [COMMENT], startAt: 0, maxResults: 50, total: 1 });
    expect(query(requests[0]).get('orderBy')).toBe('created');

    const created = await client.addComment({
      boardId: BOARD,
      issueIdOrKey: 'KAN-1',
      body: plainTextToAdf('hello'),
    });
    expect(created).toEqual(COMMENT);
    expect(requests[1].method).toBe('POST');
    expect(JSON.parse(requests[1].body)).toEqual({ body: plainTextToAdf('hello') });
  });
});

describe('JiraGatewayHttpClient webhooks', () => {
  it('registers, lists and refreshes webhooks', async () => {
    respond = (request) => {
      if (request.method === 'POST') {
        return {
          status: 200,
          body: {
            webhookRegistrationResult: [
              { createdWebhookId: 7 },
              { errors: ['jql filter is invalid'] },
            ],
          },
        };
      }
      if (request.method === 'PUT') {
        return { status: 200, body: { expirationDate: '2026-11-01T00:00:00.000Z' } };
      }
      return {
        status: 200,
        body: {
          values: [
            {
              id: 7,
              url: 'https://example.test/hook',
              jqlFilter: 'project = KAN',
              events: ['jira:issue_updated'],
              expirationDate: '2026-11-01T00:00:00.000Z',
            },
          ],
          startAt: 0,
          maxResults: 50,
          total: 1,
          isLast: true,
        },
      };
    };
    const { client } = setup();

    const registered = await client.registerWebhook({
      boardId: BOARD,
      url: 'https://example.test/hook',
      webhooks: [{ events: ['jira:issue_updated'], jqlFilter: 'project = KAN' }],
    });
    expect(registered).toEqual({
      webhookRegistrationResult: [{ createdWebhookId: 7 }, { errors: ['jql filter is invalid'] }],
    });
    expect(JSON.parse(requests[0].body)).toEqual({
      url: 'https://example.test/hook',
      webhooks: [{ events: ['jira:issue_updated'], jqlFilter: 'project = KAN' }],
    });

    const listed = await client.listWebhooks({ boardId: BOARD, startAt: 0, maxResults: 50 });
    expect(listed.total).toBe(1);
    expect(listed.isLast).toBe(true);
    expect(query(requests[1]).get('maxResults')).toBe('50');

    const refreshed = await client.refreshWebhooks({ boardId: BOARD, webhookIds: [7] });
    expect(refreshed.expirationDate).toBe('2026-11-01T00:00:00.000Z');
    expect(requests[2].method).toBe('PUT');
    expect(JSON.parse(requests[2].body)).toEqual({ webhookIds: [7] });
  });
});

describe('JiraGatewayHttpClient token freshness', () => {
  it('proactively refreshes and persists rotated tokens before the request', async () => {
    respond = () => ({ status: 200, body: { issues: [] } });
    const { client, state, atlassian, update } = setup({
      connection: makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) }),
    });
    atlassian.refreshAccessToken.mockResolvedValue(NEW_TOKENS);

    await client.searchIssues({ boardId: BOARD, jql: 'project = KAN' });

    expect(atlassian.refreshAccessToken).toHaveBeenCalledWith('refresh-1');
    expect(state.connection?.accessTokenEnc).toBe('enc(access-2)');
    expect(state.connection?.refreshTokenEnc).toBe('enc(refresh-2)');
    expect(state.connection?.expiresAt).toEqual(new Date(BASE_NOW + HOUR));
    expect(update).toHaveBeenCalled();
    expect(requests[0].headers.authorization).toBe('Bearer access-2');
  });

  it('throws JiraUnauthorizedError for an expired token without a refresh token', async () => {
    const { client, atlassian } = setup({
      connection: makeConnection({
        expiresAt: new Date(BASE_NOW - 1_000),
        refreshTokenEnc: null,
      }),
    });

    await expect(client.searchIssues({ boardId: BOARD, jql: 'x' })).rejects.toBeInstanceOf(
      JiraUnauthorizedError,
    );
    expect(atlassian.refreshAccessToken).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it('uses a still-valid token when no refresh token exists', async () => {
    respond = () => ({ status: 200, body: { issues: [] } });
    const { client, atlassian } = setup({
      connection: makeConnection({
        expiresAt: new Date(BASE_NOW + 10 * 60_000),
        refreshTokenEnc: null,
      }),
    });

    await client.searchIssues({ boardId: BOARD, jql: 'x' });

    expect(atlassian.refreshAccessToken).not.toHaveBeenCalled();
    expect(requests[0].headers.authorization).toBe('Bearer access-1');
  });

  it('does not refresh when a concurrent refresh already extended the expiry', async () => {
    respond = () => ({ status: 200, body: { issues: [] } });
    const connection = makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) });
    const { client, atlassian, findOne } = setup({ connection });
    findOne.mockReset();
    findOne
      .mockResolvedValueOnce({ ...connection })
      .mockResolvedValueOnce({ ...connection, expiresAt: new Date(BASE_NOW + HOUR) });

    await client.searchIssues({ boardId: BOARD, jql: 'x' });

    expect(atlassian.refreshAccessToken).not.toHaveBeenCalled();
    expect(requests[0].headers.authorization).toBe('Bearer access-1');
  });

  it('returns a token refreshed by another caller during the repository re-read', async () => {
    respond = () => ({ status: 200, body: { issues: [] } });
    const connection = makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) });
    const { client, atlassian, findOne } = setup({ connection });
    findOne.mockReset();
    findOne
      .mockResolvedValueOnce({ ...connection })
      .mockResolvedValueOnce({ ...connection, accessTokenEnc: 'enc(access-2)' });

    await client.searchIssues({ boardId: BOARD, jql: 'x' });

    expect(atlassian.refreshAccessToken).not.toHaveBeenCalled();
    expect(requests[0].headers.authorization).toBe('Bearer access-2');
  });

  it('refreshes after a 401 even when the expiry is in the future', async () => {
    respond = (request) =>
      request.headers.authorization === 'Bearer access-2'
        ? { status: 200, body: { issues: [] } }
        : { status: 401, body: {} };
    const { client, atlassian, state } = setup();
    atlassian.refreshAccessToken.mockResolvedValue(NEW_TOKENS);

    await client.searchIssues({ boardId: BOARD, jql: 'x' });

    expect(atlassian.refreshAccessToken).toHaveBeenCalledWith('refresh-1');
    expect(requests).toHaveLength(2);
    expect(requests[1].headers.authorization).toBe('Bearer access-2');
    expect(state.connection?.accessTokenEnc).toBe('enc(access-2)');
    expect(state.connection?.refreshTokenEnc).toBe('enc(refresh-2)');
  });

  it('reuses a token refreshed by another caller instead of refreshing again', async () => {
    const { client, state, atlassian } = setup();
    respond = (request) => {
      if (request.headers.authorization === 'Bearer access-1') {
        if (state.connection !== null) {
          state.connection.accessTokenEnc = 'enc(access-2)';
        }
        return { status: 401, body: {} };
      }
      return { status: 200, body: { issues: [] } };
    };

    await client.searchIssues({ boardId: BOARD, jql: 'x' });

    expect(atlassian.refreshAccessToken).not.toHaveBeenCalled();
    expect(requests[1].headers.authorization).toBe('Bearer access-2');
  });

  it('single-flights concurrent refreshes and removes the in-flight entry', async () => {
    respond = (request) =>
      request.headers.authorization === 'Bearer access-2'
        ? { status: 200, body: { issues: [] } }
        : { status: 401, body: {} };
    const { client, atlassian } = setup({
      connection: makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) }),
    });
    let resolveRefresh: ((tokens: AtlassianTokens) => void) | undefined;
    atlassian.refreshAccessToken.mockImplementation(
      () =>
        new Promise<AtlassianTokens>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const first = client.searchIssues({ boardId: BOARD, jql: 'x' });
    const second = client.searchIssues({ boardId: BOARD, jql: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(atlassian.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(resolveRefresh).toBeDefined();
    resolveRefresh?.(NEW_TOKENS);
    await Promise.all([first, second]);

    const inFlight = (client as unknown as { refreshInFlight: Map<string, Promise<string>> })
      .refreshInFlight;
    expect(inFlight.size).toBe(0);
    expect(requests).toHaveLength(2);
  });

  it('single-flights concurrent 401 refreshes', async () => {
    respond = (request) =>
      request.headers.authorization === 'Bearer access-2'
        ? { status: 200, body: { issues: [] } }
        : { status: 401, body: {} };
    const { client, atlassian } = setup();
    let resolveRefresh: ((tokens: AtlassianTokens) => void) | undefined;
    atlassian.refreshAccessToken.mockImplementation(
      () =>
        new Promise<AtlassianTokens>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const first = client.searchIssues({ boardId: BOARD, jql: 'x' });
    const second = client.searchIssues({ boardId: BOARD, jql: 'x' });
    while (requests.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(atlassian.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(resolveRefresh).toBeDefined();
    resolveRefresh?.(NEW_TOKENS);
    await Promise.all([first, second]);

    expect(requests).toHaveLength(4);
    expect(requests.slice(2).map((request) => request.headers.authorization)).toEqual([
      'Bearer access-2',
      'Bearer access-2',
    ]);
  });

  it('throws JiraUnauthorizedError when the connection is missing', async () => {
    const { client } = setup({ connection: null });
    await expect(client.searchIssues({ boardId: BOARD, jql: 'x' })).rejects.toBeInstanceOf(
      JiraUnauthorizedError,
    );
  });
});

describe('JiraGatewayHttpClient refresh failures', () => {
  it('conditionally clears refreshTokenEnc on invalid_grant', async () => {
    const { client, state, atlassian, update } = setup({
      connection: makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) }),
    });
    atlassian.refreshAccessToken.mockRejectedValue(
      new AtlassianRejectedError('invalid_grant', 403),
    );

    await expect(client.searchIssues({ boardId: BOARD, jql: 'x' })).rejects.toBeInstanceOf(
      JiraUnauthorizedError,
    );

    expect(update).toHaveBeenCalledWith(
      { boardId: BOARD, refreshTokenEnc: 'enc(refresh-1)' },
      { refreshTokenEnc: null },
    );
    expect(state.connection?.refreshTokenEnc).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('does not overwrite a concurrent reconnect when marking invalid_grant', async () => {
    const { client, state, atlassian } = setup({
      connection: makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) }),
    });
    atlassian.refreshAccessToken.mockImplementation(() => {
      if (state.connection !== null) {
        state.connection.refreshTokenEnc = 'enc(refresh-new)';
      }
      return Promise.reject(new AtlassianRejectedError('invalid_grant', 403));
    });

    await expect(client.searchIssues({ boardId: BOARD, jql: 'x' })).rejects.toBeInstanceOf(
      JiraUnauthorizedError,
    );
    expect(state.connection?.refreshTokenEnc).toBe('enc(refresh-new)');
  });

  it('surfaces a 5xx refresh failure as JiraServerError without clearing tokens', async () => {
    const { client, state, atlassian, update } = setup({
      connection: makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) }),
    });
    atlassian.refreshAccessToken.mockRejectedValue(new AtlassianUnavailableError('HTTP 503'));

    const failure = client.searchIssues({ boardId: BOARD, jql: 'x' });
    await expect(failure).rejects.toBeInstanceOf(JiraServerError);
    await expect(failure).rejects.toMatchObject({ status: 503, attempts: 1, maxAttempts: 1 });

    expect(state.connection?.refreshTokenEnc).toBe('enc(refresh-1)');
    expect(update.mock.calls.filter(([, patch]) => patch.refreshTokenEnc === null)).toHaveLength(0);
  });

  it('surfaces a refresh timeout as JiraTimeoutError without clearing tokens', async () => {
    const { client, state, atlassian } = setup({
      connection: makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) }),
    });
    atlassian.refreshAccessToken.mockRejectedValue(new AtlassianUnavailableError('TimeoutError'));

    const failure = client.searchIssues({ boardId: BOARD, jql: 'x' });
    await expect(failure).rejects.toBeInstanceOf(JiraTimeoutError);
    await expect(failure).rejects.toMatchObject({ attempts: 1, maxAttempts: 1 });
    expect(state.connection?.refreshTokenEnc).toBe('enc(refresh-1)');
  });

  it('does not clear tokens for a non-invalid_grant rejection', async () => {
    const { client, state, atlassian } = setup({
      connection: makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) }),
    });
    atlassian.refreshAccessToken.mockRejectedValue(
      new AtlassianRejectedError('invalid_client', 401),
    );

    await expect(client.searchIssues({ boardId: BOARD, jql: 'x' })).rejects.toBeInstanceOf(
      JiraUnauthorizedError,
    );
    expect(state.connection?.refreshTokenEnc).toBe('enc(refresh-1)');
  });
});

describe('JiraGatewayHttpClient persistence', () => {
  it('retries a failed token persistence once', async () => {
    respond = () => ({ status: 200, body: { issues: [] } });
    const { client, atlassian, update, state } = setup({
      connection: makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) }),
    });
    atlassian.refreshAccessToken.mockResolvedValue(NEW_TOKENS);
    update.mockRejectedValueOnce(new Error('database unavailable'));

    await client.searchIssues({ boardId: BOARD, jql: 'x' });

    expect(update).toHaveBeenCalledTimes(2);
    expect(state.connection?.accessTokenEnc).toBe('enc(access-2)');
    expect(requests[0].headers.authorization).toBe('Bearer access-2');
  });

  it('throws JiraPersistenceError after both persistence attempts fail', async () => {
    const { client, atlassian, update } = setup({
      connection: makeConnection({ expiresAt: new Date(BASE_NOW + 30_000) }),
    });
    atlassian.refreshAccessToken.mockResolvedValue(NEW_TOKENS);
    update.mockRejectedValue(new Error('database unavailable'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const failure = client.searchIssues({ boardId: BOARD, jql: 'x' });
    await expect(failure).rejects.toBeInstanceOf(JiraPersistenceError);
    await expect(failure).rejects.toMatchObject({ attempts: 2, maxAttempts: 2 });
    expect(requests).toHaveLength(0);

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('access-2');
    expect(logged).not.toContain('refresh-2');
  });
});

describe('JiraGatewayHttpClient retries', () => {
  it('honours a numeric Retry-After and retries once', async () => {
    let calls = 0;
    respond = () => {
      calls += 1;
      return calls === 1
        ? { status: 429, headers: { 'Retry-After': '2' }, body: {} }
        : { status: 200, body: { issues: [] } };
    };
    const { client, sleep } = setup();

    await client.searchIssues({ boardId: BOARD, jql: 'x' });

    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(requests).toHaveLength(2);
  });

  it('honours an HTTP-date Retry-After', async () => {
    let calls = 0;
    respond = () => {
      calls += 1;
      return calls === 1
        ? {
            status: 429,
            headers: { 'Retry-After': new Date(BASE_NOW + 30_000).toUTCString() },
            body: {},
          }
        : { status: 200, body: { issues: [] } };
    };
    const { client, sleep } = setup();

    await client.searchIssues({ boardId: BOARD, jql: 'x' });

    expect(sleep).toHaveBeenCalledWith(30_000);
    expect(requests).toHaveLength(2);
  });

  it('throws immediately for a Retry-After above 60 seconds', async () => {
    respond = () => ({ status: 429, headers: { 'Retry-After': '61' }, body: {} });
    const { client, sleep } = setup();

    const failure = client.searchIssues({ boardId: BOARD, jql: 'x' });
    await expect(failure).rejects.toBeInstanceOf(JiraRateLimitedError);
    await expect(failure).rejects.toMatchObject({ retryAfterSeconds: 61 });
    expect(sleep).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it('throws immediately when Retry-After is missing', async () => {
    respond = () => ({ status: 429, body: {} });
    const { client } = setup();
    await expect(client.searchIssues({ boardId: BOARD, jql: 'x' })).rejects.toBeInstanceOf(
      JiraRateLimitedError,
    );
  });

  it('throws immediately when Retry-After is not a number or date', async () => {
    respond = () => ({ status: 429, headers: { 'Retry-After': 'soon' }, body: {} });
    const { client, sleep } = setup();

    const failure = client.searchIssues({ boardId: BOARD, jql: 'x' });
    await expect(failure).rejects.toBeInstanceOf(JiraRateLimitedError);
    await expect(failure).rejects.toMatchObject({ retryAfterSeconds: null });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws on a second 429 after one retry', async () => {
    respond = () => ({ status: 429, headers: { 'Retry-After': '5' }, body: {} });
    const { client, sleep } = setup();

    const failure = client.searchIssues({ boardId: BOARD, jql: 'x' });
    await expect(failure).rejects.toBeInstanceOf(JiraRateLimitedError);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
  });

  it('retries GET 5xx three times with exponential backoff and jitter', async () => {
    respond = () => ({ status: 500, body: {} });
    const { client, sleep } = setup();

    const failure = client.searchIssues({ boardId: BOARD, jql: 'x' });
    await expect(failure).rejects.toBeInstanceOf(JiraServerError);
    await expect(failure).rejects.toMatchObject({ status: 500, attempts: 3, maxAttempts: 3 });
    expect(requests).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it('does not retry a POST 5xx', async () => {
    respond = () => ({ status: 503, body: {} });
    const { client } = setup();

    const failure = client.doTransition({
      boardId: BOARD,
      issueIdOrKey: 'KAN-1',
      transitionId: '31',
    });
    await expect(failure).rejects.toBeInstanceOf(JiraServerError);
    await expect(failure).rejects.toMatchObject({ attempts: 1, maxAttempts: 1 });
    expect(requests).toHaveLength(1);
  });

  it('retries a timed-out GET twice, but a timed-out POST never', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(timeout);
    const { client } = setup();

    await expect(client.searchIssues({ boardId: BOARD, jql: 'x' })).rejects.toMatchObject({
      code: 'TIMEOUT',
      attempts: 2,
      maxAttempts: 2,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockClear();
    await expect(
      client.doTransition({ boardId: BOARD, issueIdOrKey: 'KAN-1', transitionId: '31' }),
    ).rejects.toMatchObject({ code: 'TIMEOUT', attempts: 1, maxAttempts: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries connection-phase network errors and does not retry others for POST', async () => {
    const network = (code: string) =>
      Object.assign(new TypeError('fetch failed'), { cause: { code } });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { client } = setup();

    fetchSpy.mockRejectedValue(network('ECONNREFUSED'));
    await expect(
      client.doTransition({ boardId: BOARD, issueIdOrKey: 'KAN-1', transitionId: '31' }),
    ).rejects.toMatchObject({ status: 503, attempts: 2, maxAttempts: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockClear();
    fetchSpy.mockRejectedValue(network('ECONNRESET'));
    await expect(
      client.doTransition({ boardId: BOARD, issueIdOrKey: 'KAN-1', transitionId: '31' }),
    ).rejects.toMatchObject({ status: 503, attempts: 1, maxAttempts: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockClear();
    fetchSpy.mockRejectedValue(network('ECONNREFUSED'));
    await expect(client.searchIssues({ boardId: BOARD, jql: 'x' })).rejects.toMatchObject({
      status: 503,
      attempts: 3,
      maxAttempts: 3,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('caps the per-request timeout by the remaining call budget', async () => {
    respond = () => ({ status: 200, body: { issues: [] } });
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const { client } = setup({ timeBudgetMs: 5_000, timeoutMs: 10_000 });

    await client.searchIssues({ boardId: BOARD, jql: 'x' });

    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
  });

  it('stops before a wait that would exceed the call budget', async () => {
    respond = () => ({ status: 500, body: {} });
    const { client, sleep } = setup({ timeBudgetMs: 2_500 });

    const failure = client.searchIssues({ boardId: BOARD, jql: 'x' });
    await expect(failure).rejects.toBeInstanceOf(JiraTimeBudgetExceededError);
    await expect(failure).rejects.toMatchObject({ timeBudgetMs: 2_500, attempts: 2 });
    expect(requests).toHaveLength(2);
    expect(sleep.mock.calls).toEqual([[1_000]]);
  });

  it('stops before sleeping when Retry-After would exceed the budget', async () => {
    respond = () => ({ status: 429, headers: { 'Retry-After': '2' }, body: {} });
    const { client, sleep } = setup({ timeBudgetMs: 1_000 });

    await expect(client.searchIssues({ boardId: BOARD, jql: 'x' })).rejects.toBeInstanceOf(
      JiraTimeBudgetExceededError,
    );
    expect(sleep).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });
});
