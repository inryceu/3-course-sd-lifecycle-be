import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BoardAccessService } from '../../application/board-access.service';
import { BoardRole } from '../../domain/board-role';
import { BoardAccessGuard } from './board-access.guard';

function setup(
  requiredRoles: BoardRole[] | null,
  userRole: BoardRole | null,
  params: Record<string, string> = { boardId: 'board-1' },
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;

  const access = {
    getRole: jest.fn().mockResolvedValue(userRole),
  } as unknown as BoardAccessService;

  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'user-1' }, params }),
    }),
  } as unknown as ExecutionContext;

  const guard = new BoardAccessGuard(reflector, access);
  return { guard, context };
}

describe('BoardAccessGuard', () => {
  it('allows access if no roles are explicitly required', async () => {
    const { guard, context } = setup(null, null);
    expect(await guard.canActivate(context)).toBe(true);
  });

  it('throws NotFoundException if user is not a member of the board', async () => {
    const { guard, context } = setup([BoardRole.ADMIN], null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException if user role is not in required roles', async () => {
    const { guard, context } = setup([BoardRole.ADMIN], BoardRole.VIEWER);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows access if user has the required role', async () => {
    const { guard, context } = setup([BoardRole.ADMIN, BoardRole.MEMBER], BoardRole.MEMBER);
    expect(await guard.canActivate(context)).toBe(true);
  });
});
