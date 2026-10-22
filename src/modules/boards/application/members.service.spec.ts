import { BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthFacade } from '../../auth';
import { BoardRole } from '../domain/board-role';
import { BoardMembershipEntity } from '../infrastructure/persistence/board-membership.entity';
import { BoardAccessService } from './board-access.service';
import { MembersService } from './members.service';

const authUser = { id: 'user-2', email: 'test@example.com', displayName: 'Test User' };

function setup() {
  const memberships = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(1),
    create: jest.fn((dto) => ({ ...dto, invitedAt: new Date() })),
    save: jest.fn((entity) => Promise.resolve(entity)),
    remove: jest.fn().mockResolvedValue(undefined),
  } as unknown as Repository<BoardMembershipEntity>;

  const access = {
    requireAdmin: jest.fn().mockResolvedValue(BoardRole.ADMIN),
    requireMember: jest.fn().mockResolvedValue(BoardRole.MEMBER),
  } as unknown as BoardAccessService;

  const auth = {
    getUserByEmail: jest.fn().mockResolvedValue(authUser),
    getUserById: jest.fn().mockResolvedValue(authUser),
    verifyToken: jest.fn(),
  } as AuthFacade;

  const service = new MembersService(memberships, access, auth);
  return { service, memberships, access, auth };
}

describe('MembersService', () => {
  describe('invite', () => {
    it('successfully invites an existing user', async () => {
      const { service, memberships } = setup();
      const result = await service.invite(
        'admin-id',
        'board-id',
        'test@example.com',
        BoardRole.MEMBER,
      );

      expect(result.userId).toBe('user-2');
      expect(result.role).toBe(BoardRole.MEMBER);
      expect(memberships.save).toHaveBeenCalled();
    });

    it('throws BadRequest if user email is not found', async () => {
      const { service, auth } = setup();
      auth.getUserByEmail = jest.fn().mockResolvedValue(null);

      await expect(
        service.invite('admin-id', 'board-id', 'missing@example.com', BoardRole.MEMBER),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws Conflict if user is already a member', async () => {
      const { service, memberships } = setup();
      memberships.findOne = jest.fn().mockResolvedValue({ id: 'existing' });

      await expect(
        service.invite('admin-id', 'board-id', 'test@example.com', BoardRole.MEMBER),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateRole & remove (Last Admin protection)', () => {
    it('allows demoting an admin if there are other admins', async () => {
      const { service, memberships } = setup();
      memberships.findOne = jest
        .fn()
        .mockResolvedValue({ role: BoardRole.ADMIN, userId: 'user-2' });
      memberships.count = jest.fn().mockResolvedValue(2); // 2 admins exist

      await expect(
        service.updateRole('admin-id', 'board-id', 'user-2', BoardRole.MEMBER),
      ).resolves.toBeUndefined();
      expect(memberships.save).toHaveBeenCalled();
    });

    it('throws Conflict when trying to demote the last admin', async () => {
      const { service, memberships } = setup();
      memberships.findOne = jest
        .fn()
        .mockResolvedValue({ role: BoardRole.ADMIN, userId: 'user-2', boardId: 'board-id' });
      memberships.count = jest.fn().mockResolvedValue(1); // Only 1 admin

      await expect(
        service.updateRole('admin-id', 'board-id', 'user-2', BoardRole.MEMBER),
      ).rejects.toThrow('Cannot remove or demote the last admin');
    });

    it('throws Conflict when trying to remove the last admin', async () => {
      const { service, memberships } = setup();
      memberships.findOne = jest
        .fn()
        .mockResolvedValue({ role: BoardRole.ADMIN, userId: 'user-2', boardId: 'board-id' });
      memberships.count = jest.fn().mockResolvedValue(1);

      await expect(service.remove('admin-id', 'board-id', 'user-2')).rejects.toThrow(
        'Cannot remove or demote the last admin',
      );
    });
  });
});
