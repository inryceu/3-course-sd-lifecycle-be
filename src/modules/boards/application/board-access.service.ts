import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardRole, roleCanEdit, roleCanManage } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';

const NOT_FOUND = 'Board not found';

/**
 * Role rules in one place. A user without membership gets 404 (the board's existence is not
 * leaked); a member whose role is too weak gets 403.
 */
@Injectable()
export class BoardAccessService {
  constructor(
    @InjectRepository(BoardMembershipEntity)
    private readonly memberships: Repository<BoardMembershipEntity>,
  ) {}

  async getRole(userId: string, boardId: string): Promise<BoardRole | null> {
    const membership = await this.memberships.findOne({ where: { boardId, userId } });
    return membership?.role ?? null;
  }

  async requireMember(userId: string, boardId: string): Promise<BoardRole> {
    const role = await this.getRole(userId, boardId);
    if (!role) {
      throw new NotFoundException(NOT_FOUND);
    }
    return role;
  }

  async requireEditor(userId: string, boardId: string): Promise<BoardRole> {
    const role = await this.requireMember(userId, boardId);
    if (!roleCanEdit(role)) {
      throw new ForbiddenException('Viewers cannot change cards');
    }
    return role;
  }

  async requireAdmin(userId: string, boardId: string): Promise<BoardRole> {
    const role = await this.requireMember(userId, boardId);
    if (!roleCanManage(role)) {
      throw new ForbiddenException('Only a board admin can do this');
    }
    return role;
  }
}
