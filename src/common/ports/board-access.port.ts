/**
 * Port that answers "may this user see this board?".
 *
 * Declared in the shared kernel and implemented by the boards module so that modules which must
 * not depend on boards (realtime) can still authorise board-scoped access.
 */
export const BOARD_ACCESS = Symbol('BOARD_ACCESS');

export interface BoardAccess {
  /** True when the user is a member of the board with any role. Unknown boards yield false. */
  canView(userId: string, boardId: string): Promise<boolean>;
}
