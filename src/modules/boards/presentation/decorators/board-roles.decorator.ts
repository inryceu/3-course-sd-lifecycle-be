import { SetMetadata } from '@nestjs/common';
import { BoardRole } from '../../domain/board-role';

export const BOARD_ROLES_KEY = 'boardRoles';

/**
 * Enforces that the current user holds one of the specified roles on the board.
 */
export const BoardRoles = (...roles: BoardRole[]) => SetMetadata(BOARD_ROLES_KEY, roles);
