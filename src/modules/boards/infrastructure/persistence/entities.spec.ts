import { BoardRole } from '../../domain/board-role';
import { CrossBoardMoveError, InvalidPositionError } from '../../domain/errors';
import { BoardMembershipEntity } from './board-membership.entity';
import { CardEntity } from './card.entity';
import { CommentEntity } from './comment.entity';

function card(boardId = 'board-1', columnId = 'col-1', position = 0): CardEntity {
  return Object.assign(new CardEntity(), { id: 'card-1', boardId, columnId, position });
}

describe('CardEntity.moveTo', () => {
  it('moves to another column of the same board', () => {
    const entity = card();
    entity.moveTo({ id: 'col-2', boardId: 'board-1' }, 3);
    expect(entity.columnId).toBe('col-2');
    expect(entity.position).toBe(3);
  });

  it('can change only the position inside the same column', () => {
    const entity = card();
    entity.moveTo({ id: 'col-1', boardId: 'board-1' }, 2);
    expect(entity.columnId).toBe('col-1');
    expect(entity.position).toBe(2);
  });

  it('refuses a column of another board and leaves the card unchanged', () => {
    const entity = card();
    expect(() => entity.moveTo({ id: 'col-9', boardId: 'board-2' }, 0)).toThrow(
      CrossBoardMoveError,
    );
    expect(entity.columnId).toBe('col-1');
    expect(entity.position).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])('refuses position %s', (position) => {
    const entity = card();
    expect(() => entity.moveTo({ id: 'col-1', boardId: 'board-1' }, position)).toThrow(
      InvalidPositionError,
    );
    expect(entity.position).toBe(0);
  });
});

describe('BoardMembershipEntity', () => {
  const membership = (role: BoardRole) => Object.assign(new BoardMembershipEntity(), { role });

  it.each([
    [BoardRole.ADMIN, true],
    [BoardRole.MEMBER, true],
    [BoardRole.VIEWER, false],
  ])('canEdit for %s is %s', (role, expected) => {
    expect(membership(role).canEdit()).toBe(expected);
  });

  it('only admins manage', () => {
    expect(membership(BoardRole.ADMIN).canManage()).toBe(true);
    expect(membership(BoardRole.MEMBER).canManage()).toBe(false);
  });

  it('exposes the creation time as invitation time', () => {
    const entity = membership(BoardRole.MEMBER);
    entity.createdAt = new Date('2026-01-02T03:04:05Z');
    expect(entity.invitedAt).toEqual(entity.createdAt);
  });
});

describe('CommentEntity.markSynced', () => {
  it('flags the comment as mirrored to Jira', () => {
    const comment = Object.assign(new CommentEntity(), { syncedToJira: false });
    comment.markSynced();
    expect(comment.syncedToJira).toBe(true);
  });
});
