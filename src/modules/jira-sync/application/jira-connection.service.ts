import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BOARDS_FACADE, BoardRole, BoardsFacade } from '../../boards';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';

/** Connection status as exposed by the API. It never contains tokens. */
export interface JiraConnectionStatus {
  connected: boolean;
  boardId: string;
  cloudId: string | null;
  siteUrl: string | null;
  scopes: string[];
  expiresAt: string | null;
  connectedAt: string | null;
}

@Injectable()
export class JiraConnectionService {
  constructor(
    @InjectRepository(JiraConnectionEntity)
    private readonly connections: Repository<JiraConnectionEntity>,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
  ) {}

  /** Any board member may read the status. */
  async getStatus(userId: string, boardId: string): Promise<JiraConnectionStatus> {
    const role = await this.boards.getMemberRole(boardId, userId);
    if (!role) {
      throw new NotFoundException('Board not found');
    }
    const connection = await this.connections.findOne({ where: { boardId } });
    if (!connection) {
      return {
        connected: false,
        boardId,
        cloudId: null,
        siteUrl: null,
        scopes: [],
        expiresAt: null,
        connectedAt: null,
      };
    }
    return {
      connected: true,
      boardId,
      cloudId: connection.cloudId,
      siteUrl: connection.siteUrl,
      scopes: connection.scopes,
      expiresAt: connection.expiresAt.toISOString(),
      connectedAt: connection.connectedAt.toISOString(),
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
  }
}
