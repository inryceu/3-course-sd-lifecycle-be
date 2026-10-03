import { BoardRole, DEFAULT_COLUMNS, MIN_COLUMNS, roleCanEdit, roleCanManage } from './board-role';

describe('board roles', () => {
  it.each([
    [BoardRole.ADMIN, true],
    [BoardRole.MEMBER, true],
    [BoardRole.VIEWER, false],
  ])('%s can edit cards: %s', (role, expected) => {
    expect(roleCanEdit(role)).toBe(expected);
  });

  it.each([
    [BoardRole.ADMIN, true],
    [BoardRole.MEMBER, false],
    [BoardRole.VIEWER, false],
  ])('%s can manage structure: %s', (role, expected) => {
    expect(roleCanManage(role)).toBe(expected);
  });

  it('defaults to three columns in order To Do, In Progress, Done', () => {
    expect(DEFAULT_COLUMNS.map((column) => column.title)).toEqual(['To Do', 'In Progress', 'Done']);
    expect(DEFAULT_COLUMNS).toHaveLength(MIN_COLUMNS);
  });
});
