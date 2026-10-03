export enum BoardRole {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

export enum ColumnType {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  REVIEW = 'REVIEW',
  DONE = 'DONE',
}

/** A board never has fewer columns than this. */
export const MIN_COLUMNS = 3;

export const DEFAULT_COLUMNS: ReadonlyArray<{ title: string; type: ColumnType }> = [
  { title: 'To Do', type: ColumnType.TODO },
  { title: 'In Progress', type: ColumnType.IN_PROGRESS },
  { title: 'Done', type: ColumnType.DONE },
];

/** Admins and members change cards; viewers only read. */
export function roleCanEdit(role: BoardRole): boolean {
  return role === BoardRole.ADMIN || role === BoardRole.MEMBER;
}

/** Only admins change board settings and structure. */
export function roleCanManage(role: BoardRole): boolean {
  return role === BoardRole.ADMIN;
}
