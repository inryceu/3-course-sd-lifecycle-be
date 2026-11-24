import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JiraUnauthorizedError } from '../domain/jira-gateway.errors';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { ATLASSIAN_OAUTH, AtlassianOAuth } from './atlassian-oauth.port';
import { TOKEN_CIPHER, TokenCipher } from './token-cipher.port';

const EXPIRY_SKEW_MS = 60_000;

@Injectable()
export class JiraTokenRefreshService {
  private readonly logger = new Logger(JiraTokenRefreshService.name);
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    @InjectRepository(JiraConnectionEntity)
    private readonly connections: Repository<JiraConnectionEntity>,
    @Inject(ATLASSIAN_OAUTH) private readonly oauth: AtlassianOAuth,
    @Inject(TOKEN_CIPHER) private readonly cipher: TokenCipher,
  ) {}

  /**
   * Returns a valid decrypted access token, refreshing proactively if it is
   * about to expire within 60 seconds.
   */
  async getValidAccessToken(boardId: string): Promise<{ accessToken: string; cloudId: string }> {
    const connection = await this.connections.findOne({ where: { boardId } });
    if (!connection) {
      throw new JiraUnauthorizedError('Board is not connected to Jira');
    }
    if (connection.expiresAt.getTime() - Date.now() <= EXPIRY_SKEW_MS) {
      const accessToken = await this.refreshForBoard(boardId);
      return { accessToken, cloudId: connection.cloudId };
    }
    return {
      accessToken: this.cipher.decrypt(connection.accessTokenEnc),
      cloudId: connection.cloudId,
    };
  }

  /**
   * Deduplicates concurrent refresh calls for the same board so Atlassian's
   * rotating refresh tokens are never consumed twice in parallel.
   */
  async refreshForBoard(boardId: string): Promise<string> {
    const existing = this.inFlight.get(boardId);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this.doRefresh(boardId).finally(() => {
      if (this.inFlight.get(boardId) === promise) {
        this.inFlight.delete(boardId);
      }
    });
    this.inFlight.set(boardId, promise);
    return promise;
  }

  private async doRefresh(boardId: string): Promise<string> {
    const connection = await this.connections.findOne({ where: { boardId } });
    if (!connection) {
      throw new JiraUnauthorizedError('Board is not connected to Jira');
    }

    const plainRefreshToken = this.cipher.decrypt(connection.refreshTokenEnc);
    try {
      const tokens = await this.oauth.refreshAccessToken(plainRefreshToken);
      connection.accessTokenEnc = this.cipher.encrypt(tokens.accessToken);
      if (tokens.refreshToken) {
        connection.refreshTokenEnc = this.cipher.encrypt(tokens.refreshToken);
      }
      connection.expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
      await this.connections.save(connection);

      this.logger.log(`Refreshed Jira OAuth token for board ${boardId}`);
      return tokens.accessToken;
    } catch (error) {
      this.logger.error(
        `Failed to refresh Jira OAuth token for board ${boardId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new JiraUnauthorizedError(
        'Jira session expired and could not be refreshed; reconnect Jira',
      );
    }
  }
}
