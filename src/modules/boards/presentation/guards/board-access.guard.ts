import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BoardAccessService } from '../../application/board-access.service';
import { BoardRole } from '../../domain/board-role';
import { BOARD_ROLES_KEY } from '../decorators/board-roles.decorator';

@Injectable()
export class BoardAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: BoardAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<BoardRole[]>(BOARD_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id: string }; params: Record<string, string> }>();
    const userId = request.user?.id;
    const boardId = request.params['boardId'];

    if (!userId || !boardId) {
      return false;
    }

    const role = await this.access.getRole(userId, boardId);
    if (!role) {
      throw new NotFoundException('Board not found');
    }

    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException(`Requires one of roles: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
