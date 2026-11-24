import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { JiraUnauthorizedError } from '../domain/jira-gateway.errors';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { ATLASSIAN_OAUTH, AtlassianOAuth } from './atlassian-oauth.port';
import { TOKEN_CIPHER, TokenCipher } from './token-cipher.port';
import { JiraTokenRefreshService } from './jira-token-refresh.service';

const NOW = new Date('2026-10-03T10:00:00.000Z');

const cipher: TokenCipher = {
  encrypt: (plain) => `enc(${plain})`,
  decrypt: (stored) => (stored ? stored.replace(/^enc\((.*)\)$/, '$1') : null),
};

function setup() {
  const connections: JiraConnectionEntity[] = [];
  const connRepo = {
    findOne: jest.fn(({ where }: { where: { boardId: string } }) =>
      Promise.resolve(connections.find((c) => c.boardId === where.boardId) ?? null),
    ),
    save: jest.fn((entity: JiraConnectionEntity) => {
      const idx = connections.findIndex((c) => c.boardId === entity.boardId);
      if (idx >= 0) connections[idx] = entity;
      else connections.push(entity);
      return Promise.resolve(entity);
    }),
  } as unknown as jest.Mocked<Repository<JiraConnectionEntity>>;

  const atlassian: jest.Mocked<AtlassianOAuth> = {
    refreshAccessToken: jest.fn(),
  };

  const service = new JiraTokenRefreshService(connRepo, atlassian, cipher);

  return { service, connRepo, atlassian, connections: () => connections };
}

describe('JiraTokenRefreshService', () => {
  let loggerErrorSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('getValidAccessToken', () => {
    it('returns decrypted access token when token is still valid (expires in > 60s)', async () => {
      const { service, connRepo, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('access-token-1'),
        refreshTokenEnc: cipher.encrypt('refresh-token-1'),
        expiresAt: new Date(NOW.getTime() + 120_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      const result = await service.getValidAccessToken('board-1');

      expect(result).toEqual({
        accessToken: 'access-token-1',
        cloudId: 'cloud-1',
      });
      expect(connRepo.findOne).toHaveBeenCalledWith({ where: { boardId: 'board-1' } });
      expect(atlassian.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('refreshes token when expiring within 60 seconds', async () => {
      const { service, connRepo, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('old-access-token'),
        refreshTokenEnc: cipher.encrypt('refresh-token-1'),
        expiresAt: new Date(NOW.getTime() + 30_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      atlassian.refreshAccessToken.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
        scopes: ['read:jira-work'],
      });

      const result = await service.getValidAccessToken('board-1');

      expect(result).toEqual({
        accessToken: 'new-access-token',
        cloudId: 'cloud-1',
      });
      expect(atlassian.refreshAccessToken).toHaveBeenCalledWith('refresh-token-1');
      const saved = connections()[0];
      expect(saved.accessTokenEnc).toBe('enc(new-access-token)');
      expect(saved.refreshTokenEnc).toBe('enc(new-refresh-token)');
      expect(saved.expiresAt.getTime()).toBe(NOW.getTime() + 3600 * 1000);
    });

    it('refreshes token when already expired', async () => {
      const { service, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('old-access-token'),
        refreshTokenEnc: cipher.encrypt('refresh-token-1'),
        expiresAt: new Date(NOW.getTime() - 10_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      atlassian.refreshAccessToken.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
        scopes: ['read:jira-work'],
      });

      const result = await service.getValidAccessToken('board-1');

      expect(result.accessToken).toBe('new-access-token');
    });

    it('throws JiraUnauthorizedError when board is not connected', async () => {
      const { service } = setup();

      await expect(service.getValidAccessToken('unknown-board')).rejects.toThrow(
        JiraUnauthorizedError,
      );
      await expect(service.getValidAccessToken('unknown-board')).rejects.toThrow(
        'Board is not connected to Jira',
      );
    });

    it('throws JiraUnauthorizedError when refresh token is missing', async () => {
      const { service, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('old-access-token'),
        refreshTokenEnc: null,
        expiresAt: new Date(NOW.getTime() + 30_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      atlassian.refreshAccessToken.mockRejectedValue(new Error('no refresh token'));

      await expect(service.getValidAccessToken('board-1')).rejects.toThrow(JiraUnauthorizedError);
      await expect(service.getValidAccessToken('board-1')).rejects.toThrow(
        'Jira session expired and could not be refreshed; reconnect Jira',
      );
    });
  });

  describe('refreshForBoard', () => {
    it('deduplicates concurrent refresh calls for the same board', async () => {
      const { service, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('old-access-token'),
        refreshTokenEnc: cipher.encrypt('refresh-token-1'),
        expiresAt: new Date(NOW.getTime() - 10_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      let resolveRefresh: (value: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        scopes: string[];
      }) => void;
      const refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });
      atlassian.refreshAccessToken.mockReturnValue(refreshPromise);

      const [p1, p2, p3] = [
        service.refreshForBoard('board-1'),
        service.refreshForBoard('board-1'),
        service.refreshForBoard('board-1'),
      ];

      // With fake timers, need to flush microtasks for the async doRefresh to call the mock
      await jest.runAllTimersAsync();

      expect(atlassian.refreshAccessToken).toHaveBeenCalledTimes(1);

      resolveRefresh({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
        scopes: ['read:jira-work'],
      });

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).toBe('new-access-token');
      expect(r2).toBe('new-access-token');
      expect(r3).toBe('new-access-token');
    });

    it('allows new refresh after previous one completes', async () => {
      const { service, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('old-access-token'),
        refreshTokenEnc: cipher.encrypt('refresh-token-1'),
        expiresAt: new Date(NOW.getTime() - 10_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      atlassian.refreshAccessToken
        .mockResolvedValueOnce({
          accessToken: 'new-access-token-1',
          refreshToken: 'new-refresh-token-1',
          expiresIn: 3600,
          scopes: ['read:jira-work'],
        })
        .mockResolvedValueOnce({
          accessToken: 'new-access-token-2',
          refreshToken: 'new-refresh-token-2',
          expiresIn: 3600,
          scopes: ['read:jira-work'],
        });

      const r1 = await service.refreshForBoard('board-1');
      const r2 = await service.refreshForBoard('board-1');

      expect(r1).toBe('new-access-token-1');
      expect(r2).toBe('new-access-token-2');
      expect(atlassian.refreshAccessToken).toHaveBeenCalledTimes(2);
    });

    it('throws JiraUnauthorizedError when board is not connected', async () => {
      const { service } = setup();

      await expect(service.refreshForBoard('unknown-board')).rejects.toThrow(JiraUnauthorizedError);
    });

    it('throws JiraUnauthorizedError when refresh fails and logs error', async () => {
      const { service, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('old-access-token'),
        refreshTokenEnc: cipher.encrypt('refresh-token-1'),
        expiresAt: new Date(NOW.getTime() - 10_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      atlassian.refreshAccessToken.mockRejectedValue(new Error('invalid_grant'));

      await expect(service.refreshForBoard('board-1')).rejects.toThrow(JiraUnauthorizedError);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to refresh Jira OAuth token for board board-1'),
      );
    });

    it('updates connection with new tokens on successful refresh', async () => {
      const { service, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('old-access-token'),
        refreshTokenEnc: cipher.encrypt('refresh-token-1'),
        expiresAt: new Date(NOW.getTime() - 10_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      atlassian.refreshAccessToken.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
        scopes: ['read:jira-work'],
      });

      await service.refreshForBoard('board-1');

      const saved = connections()[0];
      expect(saved.accessTokenEnc).toBe('enc(new-access-token)');
      expect(saved.refreshTokenEnc).toBe('enc(new-refresh-token)');
      expect(saved.expiresAt.getTime()).toBe(NOW.getTime() + 3600 * 1000);
    });

    it('keeps old refresh token when new one is not provided', async () => {
      const { service, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('old-access-token'),
        refreshTokenEnc: cipher.encrypt('refresh-token-1'),
        expiresAt: new Date(NOW.getTime() - 10_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      atlassian.refreshAccessToken.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: null,
        expiresIn: 3600,
        scopes: ['read:jira-work'],
      });

      await service.refreshForBoard('board-1');

      const saved = connections()[0];
      expect(saved.accessTokenEnc).toBe('enc(new-access-token)');
      expect(saved.refreshTokenEnc).toBe('enc(refresh-token-1)');
    });

    it('logs success on token refresh', async () => {
      const { service, atlassian, connections } = setup();
      connections().push({
        id: 'conn-1',
        boardId: 'board-1',
        connectedById: 'user-1',
        cloudId: 'cloud-1',
        siteUrl: 'https://site.atlassian.net',
        accessTokenEnc: cipher.encrypt('old-access-token'),
        refreshTokenEnc: cipher.encrypt('refresh-token-1'),
        expiresAt: new Date(NOW.getTime() - 10_000),
        scopes: ['read:jira-work'],
        connectedAt: NOW,
      } as JiraConnectionEntity);

      atlassian.refreshAccessToken.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
        scopes: ['read:jira-work'],
      });

      await service.refreshForBoard('board-1');

      expect(loggerLogSpy).toHaveBeenCalledWith('Refreshed Jira OAuth token for board board-1');
    });
  });
});
