import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BOARDS_FACADE, BoardRole, BoardsFacade } from '../../boards';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraWebhookLifecycleService } from './jira-webhook-lifecycle.service';

/** Connection status as exposed by the API. It never contains tokens. */
export interface JiraConnectionStatus {
  connected: boolean;
  boardId: string;
  cloudId: string | null;
  siteUrl: string | null;
  scopes: string[];
  expiresAt: string | null;
  connectedAt: string | null;
  requiresReconnect: boolean;
}

@Injectable()
export class JiraConnectionService {
  constructor(
    @InjectRepository(JiraConnectionEntity)
    private readonly connections: Repository<JiraConnectionEntity>,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
    private readonly webhooks: JiraWebhookLifecycleService,
  ) {}

  /** Any board member may read the status. */
  async getStatus(userId: string, boardId: string): Promise<JiraConnectionStatus> {
    const role = await this.boards.getMemberRole(boardId, userId);
    if (!role) {
      throw new NotFoundException('Board not found');
    }
    const connection = await this.connections.findOne({
      where: { boardId },
      // Tokens are `select: false`; only the null-ness of the refresh token is read, never exposed.
      select: {
        cloudId: true,
        siteUrl: true,
        scopes: true,
        expiresAt: true,
        connectedAt: true,
        refreshTokenEnc: true,
      },
    });
    if (!connection) {
      return {
        connected: false,
        boardId,
        cloudId: null,
        siteUrl: null,
        scopes: [],
        expiresAt: null,
        connectedAt: null,
        requiresReconnect: false,
      };
    }
    // Same condition as the gateway's "reconnect required": the refresh token is gone (cleared on
    // invalid_grant) and the access token can no longer be used. An expired access token alone is
    // refreshed transparently on the next call.
    const requiresReconnect =
      connection.refreshTokenEnc === null && connection.expiresAt.getTime() <= Date.now();
    return {
      connected: true,
      boardId,
      cloudId: connection.cloudId,
      siteUrl: connection.siteUrl,
      scopes: connection.scopes,
      expiresAt: connection.expiresAt.toISOString(),
      connectedAt: connection.connectedAt.toISOString(),
      requiresReconnect,
    };
  }

  /** Deletes the stored credentials; only the board Admin may disconnect. */
  async disconnect(userId: string, boardId: string): Promise<void> {
    const role = await this.boards.getMemberRole(boardId, userId);
    if (!role) {
      throw new NotFoundException('Board not found');
    }
    if (role !== BoardRole.ADMIN) {
      throw new ForbiddenException('Only a board admin can manage the Jira connection');
    }
    await this.connections.delete({ boardId });
    await this.webhooks.removeForBoard(boardId);
  }
}
