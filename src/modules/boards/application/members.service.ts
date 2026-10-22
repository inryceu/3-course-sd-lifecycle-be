import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AUTH_FACADE, AuthFacade } from '../../auth';
import { BoardRole } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import { BoardAccessService } from './board-access.service';

export interface MemberView {
  userId: string;
  email: string;
  displayName: string;
  role: BoardRole;
  invitedAt: string;
}

@Injectable()
export class MembersService {
  constructor(
    @InjectRepository(BoardMembershipEntity)
    private readonly memberships: Repository<BoardMembershipEntity>,
    private readonly access: BoardAccessService,
    @Inject(AUTH_FACADE) private readonly auth: AuthFacade,
  ) {}

  async list(userId: string, boardId: string): Promise<MemberView[]> {
    await this.access.requireMember(userId, boardId);
    const members = await this.memberships.find({
      where: { boardId },
      order: { createdAt: 'ASC' },
    });

    return Promise.all(
      members.map(async (m) => {
        const user = await this.auth.getUserById(m.userId);
        return {
          userId: m.userId,
          email: user?.email ?? 'Unknown',
          displayName: user?.displayName ?? 'Unknown',
          role: m.role,
          invitedAt: m.invitedAt.toISOString(),
        };
      }),
    );
  }

  async invite(
    actorId: string,
    boardId: string,
    email: string,
    role: BoardRole,
  ): Promise<MemberView> {
    await this.access.requireAdmin(actorId, boardId);

    const targetUser = await this.auth.getUserByEmail(email);
    if (!targetUser) {
      throw new BadRequestException('User with this email not found');
    }

    const existing = await this.memberships.findOne({ where: { boardId, userId: targetUser.id } });
    if (existing) {
      throw new ConflictException('User is already a member of this board');
    }

    const saved = await this.memberships.save(
      this.memberships.create({
        boardId,
        userId: targetUser.id,
        role,
      }),
    );

    return {
      userId: saved.userId,
      email: targetUser.email,
      displayName: targetUser.displayName,
      role: saved.role,
      invitedAt: saved.invitedAt.toISOString(),
    };
  }

  async updateRole(
    actorId: string,
    boardId: string,
    targetUserId: string,
    role: BoardRole,
  ): Promise<void> {
    await this.access.requireAdmin(actorId, boardId);

    const membership = await this.memberships.findOne({ where: { boardId, userId: targetUserId } });
    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    if (membership.role === BoardRole.ADMIN && role !== BoardRole.ADMIN) {
      await this.ensureAnotherAdmin(boardId, targetUserId);
    }

    membership.role = role;
    await this.memberships.save(membership);
  }

  async remove(actorId: string, boardId: string, targetUserId: string): Promise<void> {
    await this.access.requireAdmin(actorId, boardId);

    const membership = await this.memberships.findOne({ where: { boardId, userId: targetUserId } });
    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    if (membership.role === BoardRole.ADMIN) {
      await this.ensureAnotherAdmin(boardId, targetUserId);
    }

    await this.memberships.remove(membership);
  }

  private async ensureAnotherAdmin(boardId: string, excludingUserId: string): Promise<void> {
    const adminCount = await this.memberships.count({
      where: { boardId, role: BoardRole.ADMIN },
    });

    const selfIsAdmin = await this.memberships.findOne({
      where: { boardId, userId: excludingUserId, role: BoardRole.ADMIN },
    });
    if (adminCount <= 1 && selfIsAdmin) {
      throw new ConflictException('Cannot remove or demote the last admin of the board');
    }
  }
}
