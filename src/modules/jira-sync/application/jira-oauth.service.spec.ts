import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { BoardRole } from '../../boards';
import { AtlassianRejectedError, AtlassianUnavailableError } from '../domain/errors';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraOAuthStateEntity } from '../infrastructure/persistence/jira-oauth-state.entity';
import { AtlassianOAuth } from './atlassian-oauth.port';
import { JiraOAuthService, STATE_TTL_MS } from './jira-oauth.service';
import { codeChallenge } from './pkce';
import { TokenCipher } from './token-cipher.port';

const USER = 'user-1';
const BOARD = 'board-1';
const NOW = new Date('2026-10-03T10:00:00.000Z');

/** Reversible fake cipher so tests can see that values pass through it. */
const cipher: TokenCipher = {
  encrypt: (plain) => `enc(${plain})`,
  decrypt: (stored) => stored.replace(/^enc\((.*)\)$/, '$1'),
};

function setup(role: BoardRole | null = BoardRole.ADMIN) {
  let rows: JiraOAuthStateEntity[] = [];
  const states = {
    create: (input: Partial<JiraOAuthStateEntity>) => input as JiraOAuthStateEntity,
    save: jest.fn((row: JiraOAuthStateEntity) => {
      rows.push(row);
      return Promise.resolve(row);
    }),
    findOne: jest.fn(({ where }: { where: { state: string } }) =>
      Promise.resolve(rows.find((row) => row.state === where.state) ?? null),
    ),
    delete: jest.fn((criteria: { id?: string; expiresAt?: unknown }) => {
      const before = rows.length;
      if (criteria.id) rows = rows.filter((row) => (row as { id?: string }).id !== criteria.id);
      else rows = rows.filter((row) => row.expiresAt.getTime() > NOW.getTime());
      return Promise.resolve({ affected: before - rows.length });
    }),
  };
  const connections = { upsert: jest.fn().mockResolvedValue(undefined) };
  const boards = { getMemberRole: jest.fn().mockResolvedValue(role) };
  const atlassian: jest.Mocked<AtlassianOAuth> = {
    exchangeCode: jest.fn().mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresIn: 3600,
      scopes: ['read:jira-work', 'offline_access'],
    }),
    listAccessibleResources: jest.fn().mockResolvedValue([
      {
        id: 'cloud-1',
        url: 'https://acme.atlassian.net',
        name: 'Acme',
        scopes: ['read:jira-work'],
      },
    ]),
    createIssue: jest.fn(),
    updateIssue: jest.fn(),
    getTransitions: jest.fn(),
    transitionIssue: jest.fn(),
    addComment: jest.fn(),
  };
  const config = {
    getOrThrow: (key: string) =>
      ({
        'jira.clientId': 'client-id',
        'jira.clientSecret': 'client-secret',
        'jira.redirectUri': 'http://localhost:5173/jira/callback',
        'jira.scopes': ['read:jira-work', 'write:jira-work', 'offline_access'],
        'jira.authBaseUrl': 'https://auth.atlassian.com/',
      })[key],
  };
  const service = new JiraOAuthService(
    states as unknown as Repository<JiraOAuthStateEntity>,
    connections as unknown as Repository<JiraConnectionEntity>,
    boards,
    atlassian,
    cipher,
    config as never,
  );
  // Give saved rows an id like the database would.
  states.save.mockImplementation((row: JiraOAuthStateEntity) => {
    const saved = Object.assign(row, { id: `state-row-${rows.length + 1}` });
    rows.push(saved);
    return Promise.resolve(saved);
  });
  return { service, states, connections, boards, atlassian, rows: () => rows };
}

async function started(ctx: ReturnType<typeof setup>) {
  const { authorizeUrl } = await ctx.service.start(USER, BOARD, NOW);
  return { authorizeUrl, state: new URL(authorizeUrl).searchParams.get('state') };
}

describe('JiraOAuthService.start', () => {
  it('returns an authorise URL with client, scopes, redirect, state and a PKCE S256 challenge', async () => {
    const ctx = setup();

    const { authorizeUrl } = await ctx.service.start(USER, BOARD, NOW);
    const url = new URL(authorizeUrl);

    expect(`${url.origin}${url.pathname}`).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('scope')).toBe('read:jira-work write:jira-work offline_access');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/jira/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores state and the (encrypted) verifier for 10 minutes and the challenge matches it', async () => {
    const ctx = setup();

    const { authorizeUrl } = await ctx.service.start(USER, BOARD, NOW);
    const stored = ctx.rows()[0];

    expect(stored.userId).toBe(USER);
    expect(stored.boardId).toBe(BOARD);
    expect(stored.expiresAt.getTime() - NOW.getTime()).toBe(10 * 60 * 1000);
    expect(STATE_TTL_MS).toBe(10 * 60 * 1000);
    expect(stored.codeVerifierEnc).toMatch(/^enc\(/);
    const verifier = cipher.decrypt(stored.codeVerifierEnc);
    expect(new URL(authorizeUrl).searchParams.get('code_challenge')).toBe(codeChallenge(verifier));
  });

  it('purges expired states', async () => {
    const ctx = setup();
    await ctx.service.start(USER, BOARD, new Date(NOW.getTime() - 3 * STATE_TTL_MS));

    await ctx.service.start(USER, BOARD, NOW);

    expect(ctx.rows()).toHaveLength(1);
  });

  it('refuses a member who is not admin', async () => {
    const ctx = setup(BoardRole.MEMBER);
    await expect(ctx.service.start(USER, BOARD, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.states.save).not.toHaveBeenCalled();
  });

  it('answers 404 for a user outside the board', async () => {
    const ctx = setup(null);
    await expect(ctx.service.start(USER, BOARD, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('JiraOAuthService.callback', () => {
  it('exchanges the code with the stored verifier and stores the tokens encrypted', async () => {
    const ctx = setup();
    const { state } = await started(ctx);
    const verifier = cipher.decrypt(ctx.rows()[0].codeVerifierEnc);

    const result = await ctx.service.callback(USER, { code: 'code-1', state }, NOW);

    expect(result).toEqual({
      connected: true,
      cloudId: 'cloud-1',
      siteUrl: 'https://acme.atlassian.net',
    });
    expect(ctx.atlassian.exchangeCode).toHaveBeenCalledWith({
      code: 'code-1',
      codeVerifier: verifier,
    });
    const [row, conflictKeys] = ctx.connections.upsert.mock.calls[0] as [
      Record<string, unknown>,
      string[],
    ];
    expect(conflictKeys).toEqual(['boardId']);
    expect(row).toMatchObject({
      boardId: BOARD,
      connectedById: USER,
      cloudId: 'cloud-1',
      accessTokenEnc: 'enc(access-1)',
      refreshTokenEnc: 'enc(refresh-1)',
      scopes: ['read:jira-work', 'offline_access'],
    });
    expect(JSON.stringify(row)).not.toContain('"access-1"');
    expect((row.expiresAt as Date).getTime()).toBe(NOW.getTime() + 3600 * 1000);
  });

  it('stores a missing refresh token as null', async () => {
    const ctx = setup();
    ctx.atlassian.exchangeCode.mockResolvedValueOnce({
      accessToken: 'a',
      refreshToken: null,
      expiresIn: 60,
      scopes: [],
    });
    const { state } = await started(ctx);

    await ctx.service.callback(USER, { code: 'c', state }, NOW);

    expect(ctx.connections.upsert.mock.calls[0][0]).toMatchObject({ refreshTokenEnc: null });
  });

  it('rejects a state that was never issued', async () => {
    const ctx = setup();
    await expect(
      ctx.service.callback(USER, { code: 'c', state: 'unknown' }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.connections.upsert).not.toHaveBeenCalled();
  });

  it('rejects an expired state and does not store anything', async () => {
    const ctx = setup();
    const { state } = await started(ctx);
    const later = new Date(NOW.getTime() + STATE_TTL_MS + 1000);

    await expect(ctx.service.callback(USER, { code: 'c', state }, later)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.atlassian.exchangeCode).not.toHaveBeenCalled();
    expect(ctx.connections.upsert).not.toHaveBeenCalled();
  });

  it('cannot be replayed: the state is consumed on first use', async () => {
    const ctx = setup();
    const { state } = await started(ctx);
    await ctx.service.callback(USER, { code: 'c', state }, NOW);

    await expect(ctx.service.callback(USER, { code: 'c', state }, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.atlassian.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('rejects another user presenting the state and keeps it valid for its owner', async () => {
    const ctx = setup();
    const { state } = await started(ctx);

    await expect(
      ctx.service.callback('someone-else', { code: 'c', state }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.rows()).toHaveLength(1);

    await expect(ctx.service.callback(USER, { code: 'c', state }, NOW)).resolves.toMatchObject({
      connected: true,
    });
  });

  it('turns a denied consent into 400, discards the state and stores nothing', async () => {
    const ctx = setup();
    const { state } = await started(ctx);

    await expect(
      ctx.service.callback(USER, { state, error: 'access_denied' }, NOW),
    ).rejects.toThrow(/access_denied/);

    expect(ctx.rows()).toHaveLength(0);
    expect(ctx.atlassian.exchangeCode).not.toHaveBeenCalled();
    expect(ctx.connections.upsert).not.toHaveBeenCalled();
  });

  it('requires a code when consent was granted', async () => {
    const ctx = setup();
    const { state } = await started(ctx);
    await expect(ctx.service.callback(USER, { state }, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('answers 400 when Atlassian rejects the code and stores nothing', async () => {
    const ctx = setup();
    ctx.atlassian.exchangeCode.mockRejectedValueOnce(
      new AtlassianRejectedError('invalid_grant', 403),
    );
    const { state } = await started(ctx);

    await expect(ctx.service.callback(USER, { code: 'bad', state }, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.connections.upsert).not.toHaveBeenCalled();
  });

  it('answers 502 when Atlassian is unreachable', async () => {
    const ctx = setup();
    ctx.atlassian.exchangeCode.mockRejectedValueOnce(new AtlassianUnavailableError('timeout'));
    const { state } = await started(ctx);

    await expect(ctx.service.callback(USER, { code: 'c', state }, NOW)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(ctx.connections.upsert).not.toHaveBeenCalled();
  });

  it('answers 400 when the account has no accessible Jira site', async () => {
    const ctx = setup();
    ctx.atlassian.listAccessibleResources.mockResolvedValueOnce([]);
    const { state } = await started(ctx);

    await expect(ctx.service.callback(USER, { code: 'c', state }, NOW)).rejects.toThrow(
      /no accessible Jira site/,
    );
    expect(ctx.connections.upsert).not.toHaveBeenCalled();
  });

  it('picks the site that granted the Jira work scope', async () => {
    const ctx = setup();
    ctx.atlassian.listAccessibleResources.mockResolvedValueOnce([
      { id: 'confluence', url: 'https://c.example', name: 'C', scopes: ['read:confluence'] },
      { id: 'jira', url: 'https://j.example', name: 'J', scopes: ['read:jira-work'] },
    ]);
    const { state } = await started(ctx);

    const result = await ctx.service.callback(USER, { code: 'c', state }, NOW);

    expect(result.cloudId).toBe('jira');
  });

  it('refuses when the user lost the Admin role during the flow', async () => {
    const ctx = setup();
    const { state } = await started(ctx);
    ctx.boards.getMemberRole.mockResolvedValue(BoardRole.MEMBER);

    await expect(ctx.service.callback(USER, { code: 'c', state }, NOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ctx.connections.upsert).not.toHaveBeenCalled();
  });
});
