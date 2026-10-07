import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { BOARDS_FACADE, BoardRole, BoardsFacade } from '../../boards';
import { AtlassianRejectedError, AtlassianUnavailableError } from '../domain/errors';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraOAuthStateEntity } from '../infrastructure/persistence/jira-oauth-state.entity';
import { ATLASSIAN_OAUTH, AtlassianOAuth } from './atlassian-oauth.port';
import { codeChallenge, generateCodeVerifier, generateState } from './pkce';
import { TOKEN_CIPHER, TokenCipher } from './token-cipher.port';

/** A started flow must be completed within this time. */
export const STATE_TTL_MS = 10 * 60 * 1000;

const JIRA_WORK_SCOPE = 'read:jira-work';

export interface OAuthStartResult {
  authorizeUrl: string;
}

export interface OAuthCallbackInput {
  code?: string;
  state: string;
  error?: string;
}

export interface OAuthCallbackResult {
  connected: true;
  cloudId: string;
  siteUrl: string;
}

@Injectable()
export class JiraOAuthService {
  constructor(
    @InjectRepository(JiraOAuthStateEntity)
    private readonly states: Repository<JiraOAuthStateEntity>,
    @InjectRepository(JiraConnectionEntity)
    private readonly connections: Repository<JiraConnectionEntity>,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
    @Inject(ATLASSIAN_OAUTH) private readonly atlassian: AtlassianOAuth,
    @Inject(TOKEN_CIPHER) private readonly cipher: TokenCipher,
    private readonly config: ConfigService,
  ) {}

  /** Returns the Atlassian authorise URL for a board; only the board Admin may start the flow. */
  async start(userId: string, boardId: string, now = new Date()): Promise<OAuthStartResult> {
    await this.requireAdmin(userId, boardId);
    await this.states.delete({ expiresAt: LessThan(now) });

    const state = generateState();
    const verifier = generateCodeVerifier();
    await this.states.save(
      this.states.create({
        state,
        codeVerifierEnc: this.cipher.encrypt(verifier),
        userId,
        boardId,
        expiresAt: new Date(now.getTime() + STATE_TTL_MS),
      }),
    );

    const url = new URL(`${this.authBase()}/authorize`);
    url.searchParams.set('audience', 'api.atlassian.com');
    url.searchParams.set('client_id', this.config.getOrThrow<string>('jira.clientId'));
    url.searchParams.set('scope', this.config.getOrThrow<string[]>('jira.scopes').join(' '));
    url.searchParams.set('redirect_uri', this.config.getOrThrow<string>('jira.redirectUri'));
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('code_challenge', codeChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    return { authorizeUrl: url.toString() };
  }

  /**
   * Completes the flow. The state is single use and bound to the user who started the flow; it is
   * consumed before anything else can fail so it can never be replayed.
   */
  async callback(
    userId: string,
    input: OAuthCallbackInput,
    now = new Date(),
  ): Promise<OAuthCallbackResult> {
    const record = await this.states.findOne({ where: { state: input.state } });
    if (!record || record.userId !== userId) {
      throw new BadRequestException('Invalid or expired state');
    }

    const consumed = await this.states.delete({ id: record.id });
    if (consumed.affected !== 1) {
      throw new BadRequestException('Invalid or expired state');
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException('Invalid or expired state');
    }
    if (input.error) {
      throw new BadRequestException(`Jira access was not granted (${input.error})`);
    }
    if (!input.code) {
      throw new BadRequestException('Missing authorization code');
    }
    await this.requireAdmin(userId, record.boardId);

    const codeVerifier = this.cipher.decrypt(record.codeVerifierEnc);
    try {
      const tokens = await this.atlassian.exchangeCode({ code: input.code, codeVerifier });
      const resources = await this.atlassian.listAccessibleResources(tokens.accessToken);
      const site =
        resources.find((resource) => resource.scopes.includes(JIRA_WORK_SCOPE)) ?? resources[0];
      if (!site) {
        throw new BadRequestException('The account has no accessible Jira site');
      }

      await this.connections.upsert(
        {
          boardId: record.boardId,
          connectedById: userId,
          cloudId: site.id,
          siteUrl: site.url,
          accessTokenEnc: this.cipher.encrypt(tokens.accessToken),
          refreshTokenEnc: tokens.refreshToken ? this.cipher.encrypt(tokens.refreshToken) : null,
          expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
          scopes: tokens.scopes,
          connectedAt: now,
        },
        ['boardId'],
      );
      return { connected: true, cloudId: site.id, siteUrl: site.url };
    } catch (error) {
      if (error instanceof AtlassianRejectedError) {
        throw new BadRequestException('Jira authorization failed');
      }
      if (error instanceof AtlassianUnavailableError) {
        throw new BadGatewayException('Jira is currently unreachable');
      }
      throw error;
    }
  }

  private async requireAdmin(userId: string, boardId: string): Promise<void> {
    const role = await this.boards.getMemberRole(boardId, userId);
    if (!role) {
      throw new NotFoundException('Board not found');
    }
    if (role !== BoardRole.ADMIN) {
      throw new ForbiddenException('Only a board admin can manage the Jira connection');
    }
  }

  private authBase(): string {
    return this.config.getOrThrow<string>('jira.authBaseUrl').replace(/\/+$/, '');
  }
}
