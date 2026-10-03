import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BoardRole } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import { BoardAccessService } from './board-access.service';

function serviceWithRole(role: BoardRole | null) {
  const repository = {
    findOne: jest.fn().mockResolvedValue(role ? { role } : null),
  } as unknown as Repository<BoardMembershipEntity>;
  return new BoardAccessService(repository);
}

describe('BoardAccessService', () => {
  it('returns the role of a member and null for a stranger', async () => {
    expect(await serviceWithRole(BoardRole.MEMBER).getRole('u', 'b')).toBe(BoardRole.MEMBER);
    expect(await serviceWithRole(null).getRole('u', 'b')).toBeNull();
  });

  describe('requireMember', () => {
    it.each([BoardRole.ADMIN, BoardRole.MEMBER, BoardRole.VIEWER])('accepts %s', async (role) => {
      expect(await serviceWithRole(role).requireMember('u', 'b')).toBe(role);
    });

    it('answers 404 for a non-member so the board existence is not leaked', async () => {
      await expect(serviceWithRole(null).requireMember('u', 'b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('requireEditor', () => {
    it.each([BoardRole.ADMIN, BoardRole.MEMBER])('accepts %s', async (role) => {
      await expect(serviceWithRole(role).requireEditor('u', 'b')).resolves.toBe(role);
    });

    it('answers 403 for a viewer', async () => {
      await expect(
        serviceWithRole(BoardRole.VIEWER).requireEditor('u', 'b'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('answers 404 for a non-member', async () => {
      await expect(serviceWithRole(null).requireEditor('u', 'b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('requireAdmin', () => {
    it('accepts an admin', async () => {
      await expect(serviceWithRole(BoardRole.ADMIN).requireAdmin('u', 'b')).resolves.toBe(
        BoardRole.ADMIN,
      );
    });

    it.each([BoardRole.MEMBER, BoardRole.VIEWER])('answers 403 for %s', async (role) => {
      await expect(serviceWithRole(role).requireAdmin('u', 'b')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('answers 404 for a non-member', async () => {
      await expect(serviceWithRole(null).requireAdmin('u', 'b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
