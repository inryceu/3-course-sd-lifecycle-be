import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { EventPublisher } from '../../../common/events';
import { BoardRole } from '../domain/board-role';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { CommentEntity } from '../infrastructure/persistence/comment.entity';
import { LabelEntity } from '../infrastructure/persistence/label.entity';
import { BoardAccessService } from './board-access.service';
import { CommentsService } from './comments.service';
import { LabelsService } from './labels.service';

const T0 = new Date('2026-10-27T10:00:00.000Z');
const CARD = '11111111-1111-4111-8111-111111111111';
const COMMENT = '22222222-2222-4222-8222-222222222222';

const uniqueViolation = () =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('dup'), { code: '23505' }));

const access = (role: BoardRole) =>
  ({
    requireMember: jest.fn().mockResolvedValue(role),
    requireEditor: jest.fn(() =>
      role === BoardRole.VIEWER ? Promise.reject(new ForbiddenException()) : Promise.resolve(role),
    ),
  }) as unknown as BoardAccessService;

const board = {
  id: 'b1',
  title: 'B',
  description: null,
  jiraProjectKey: null,
  createdAt: T0,
  updatedAt: T0,
};
const card = (labels: object[] = []) =>
  Object.assign(new CardEntity(), {
    id: 'c1',
    boardId: 'b1',
    columnId: 'col',
    title: 'T',
    position: 0,
    labels,
    createdAt: T0,
    updatedAt: T0,
  });

function labelsSetup(role = BoardRole.MEMBER) {
  const labels = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: 'l1', boardId: 'b1', name: 'Bug', color: '#000' }),
    create: jest.fn((v: object) => v),
    save: jest.fn((v: object) => Promise.resolve(v)),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const cards = {
    findOne: jest.fn().mockResolvedValue(card()),
    save: jest.fn((v: CardEntity) => Promise.resolve(v)),
  };
  const boards = { findOneOrFail: jest.fn().mockResolvedValue(board) };
  const publish = jest.fn().mockResolvedValue(undefined);
  const service = new LabelsService(
    labels as unknown as Repository<LabelEntity>,
    cards as unknown as Repository<CardEntity>,
    boards as unknown as Repository<BoardEntity>,
    access(role),
    { publish } as unknown as EventPublisher,
  );
  return { service, labels, cards, publish };
}

describe('LabelsService gaps', () => {
  it('lists labels of the board by name for a member', async () => {
    const { service, labels } = labelsSetup();
    await service.list('u1', 'b1');
    expect(labels.find).toHaveBeenCalledWith({ where: { boardId: 'b1' }, order: { name: 'ASC' } });
  });

  it('answers 409 for a duplicate name on create and update, and rethrows other failures', async () => {
    const dup = labelsSetup();
    dup.labels.save.mockRejectedValue(uniqueViolation());
    await expect(dup.service.create('u1', 'b1', 'Bug')).rejects.toThrow(
      'already exists on this board',
    );
    await expect(dup.service.update('u1', 'l1', 'Bug')).rejects.toThrow('already exists');

    const broken = labelsSetup();
    broken.labels.save.mockRejectedValue(new Error('database down'));
    await expect(broken.service.create('u1', 'b1', 'Bug')).rejects.toThrow('database down');
    await expect(broken.service.update('u1', 'l1', 'Bug')).rejects.toThrow('database down');
  });

  it('refuses a Viewer on every write and does not save', async () => {
    const { service, labels, cards, publish } = labelsSetup(BoardRole.VIEWER);
    await expect(service.create('u1', 'b1', 'x')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update('u1', 'l1', 'x')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.delete('u1', 'l1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.attachToCard('u1', 'c1', 'l1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.detachFromCard('u1', 'c1', 'l1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(labels.save).not.toHaveBeenCalled();
    expect(labels.remove).not.toHaveBeenCalled();
    expect(cards.save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('updates only the sent fields', async () => {
    const { service, labels } = labelsSetup();
    await service.update('u1', 'l1', undefined, '#fff');
    expect(labels.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bug', color: '#fff' }),
    );
  });

  it('answers 404 for an unknown label or card', async () => {
    const { service, labels, cards } = labelsSetup();
    labels.findOne.mockResolvedValue(null);
    await expect(service.update('u1', 'x', 'n')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    cards.findOne.mockResolvedValue(card());
    await expect(service.attachToCard('u1', 'c1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    cards.findOne.mockResolvedValue(null);
    await expect(service.attachToCard('u1', 'x', 'l1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.detachFromCard('u1', 'x', 'l1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('looks the label up on the card board only (a foreign label is 404)', async () => {
    const { service, labels } = labelsSetup();
    await service.attachToCard('u1', 'c1', 'l1');
    expect(labels.findOne).toHaveBeenCalledWith({ where: { id: 'l1', boardId: 'b1' } });
  });

  it('deleting a label announces board.updated', async () => {
    const { service, labels, publish } = labelsSetup();
    await service.delete('u1', 'l1');
    expect(labels.remove).toHaveBeenCalled();
    expect(publish.mock.calls[0][0]).toMatchObject({
      type: 'board.updated',
      boardId: 'b1',
      actorId: 'u1',
    });
  });

  it('attaching an already attached label and detaching an absent one change and announce nothing', async () => {
    const attached = labelsSetup();
    attached.cards.findOne.mockResolvedValue(card([{ id: 'l1' }]));
    const view = await attached.service.attachToCard('u1', 'c1', 'l1');
    expect(view.labelIds).toEqual(['l1']);
    expect(attached.cards.save).not.toHaveBeenCalled();
    expect(attached.publish).not.toHaveBeenCalled();

    const absent = labelsSetup();
    await absent.service.detachFromCard('u1', 'c1', 'l1');
    expect(absent.cards.save).not.toHaveBeenCalled();
    expect(absent.publish).not.toHaveBeenCalled();
  });

  it('detaching an attached label saves the card without it and announces card.updated', async () => {
    const { service, cards, publish } = labelsSetup();
    cards.findOne.mockResolvedValue(card([{ id: 'l1' }, { id: 'l2' }]));
    const view = await service.detachFromCard('u1', 'c1', 'l1');
    expect(view.labelIds).toEqual(['l2']);
    expect(publish.mock.calls[0][0]).toMatchObject({ type: 'card.updated' });
  });
});

const comment = (over: Partial<CommentEntity> = {}) =>
  Object.assign(new CommentEntity(), {
    id: COMMENT,
    cardId: CARD,
    authorId: 'author',
    text: 'hi',
    syncedToJira: false,
    createdAt: T0,
    ...over,
  });

function commentsSetup(role = BoardRole.MEMBER) {
  const qb: Record<string, jest.Mock> = {};
  for (const name of ['addSelect', 'where', 'orderBy', 'addOrderBy', 'limit', 'andWhere']) {
    qb[name] = jest.fn(() => qb);
  }
  qb.getRawAndEntities = jest.fn().mockResolvedValue({ entities: [], raw: [] });
  const comments = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn().mockResolvedValue(comment()),
    create: jest.fn((v: object) => Object.assign(comment(), v)),
    save: jest.fn((v: CommentEntity) => Promise.resolve(v)),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const cards = { findOne: jest.fn().mockResolvedValue({ id: CARD, boardId: 'b1' }) };
  const boards = { findOneOrFail: jest.fn().mockResolvedValue(board) };
  const publish = jest.fn().mockResolvedValue(undefined);
  const service = new CommentsService(
    comments as unknown as Repository<CommentEntity>,
    cards as unknown as Repository<CardEntity>,
    boards as unknown as Repository<BoardEntity>,
    access(role),
    { publish } as unknown as EventPublisher,
  );
  return { service, qb, comments, cards, publish };
}

const cursorFor = (cardId: string, ts: string, id: string) =>
  Buffer.from(`${cardId}|${ts}|${id}`).toString('base64url');

describe('CommentsService gaps', () => {
  describe('list', () => {
    it('answers 404 for an unknown card', async () => {
      const { service, cards } = commentsSetup();
      cards.findOne.mockResolvedValue(null);
      await expect(service.list('u1', CARD)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('falls back to 50 for a limit outside 1..100 and asks for one extra row to detect a next page', async () => {
      for (const [limit, expected] of [
        [0, 51],
        [101, 51],
        [-3, 51],
        [100, 101],
        [1, 2],
      ]) {
        const { service, qb } = commentsSetup();
        await service.list('u1', CARD, limit);
        expect(qb.limit).toHaveBeenCalledWith(expected);
      }
    });

    it('returns a next cursor only when more rows exist, pointing at the last returned item', async () => {
      const { service, qb } = commentsSetup();
      const rows = [comment({ id: 'a' }), comment({ id: 'b' }), comment({ id: COMMENT })];
      qb.getRawAndEntities.mockResolvedValue({
        entities: rows,
        raw: [
          { cursor_ts: 't0' },
          { cursor_ts: '2026-10-27T10:00:00.000001' },
          { cursor_ts: 't2' },
        ],
      });
      const page = await service.list('u1', CARD, 2);
      expect(page.items.map((c) => c.id)).toEqual(['a', 'b']);
      expect(Buffer.from(page.nextCursor, 'base64url').toString()).toBe(
        `${CARD}|2026-10-27T10:00:00.000001|b`,
      );

      qb.getRawAndEntities.mockResolvedValue({ entities: rows.slice(0, 2), raw: [] });
      expect((await service.list('u1', CARD, 2)).nextCursor).toBeNull();
    });

    it('applies a valid cursor as a keyset condition', async () => {
      const { service, qb } = commentsSetup();
      await service.list('u1', CARD, 10, cursorFor(CARD, '2026-10-27T10:00:00.000001', COMMENT));
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('> ('), {
        ts: '2026-10-27T10:00:00.000001',
        id: COMMENT,
      });
    });

    it.each([
      ['not base64 of the expected shape', 'garbage'],
      [
        'a cursor of another card',
        cursorFor('99999999-9999-4999-8999-999999999999', '2026-10-27T10:00:00.000001', COMMENT),
      ],
      ['an id that is not a uuid', cursorFor(CARD, '2026-10-27T10:00:00.000001', 'nope')],
      ['a timestamp without microseconds', cursorFor(CARD, '2026-10-27T10:00:00', COMMENT)],
      ['an impossible date', cursorFor(CARD, '2026-02-30T10:00:00.000001', COMMENT)],
      [
        'an extra segment',
        `${Buffer.from(`${CARD}|2026-10-27T10:00:00.000001|${COMMENT}|x`).toString('base64url')}`,
      ],
    ])('rejects %s with 400 before querying', async (_name, cursor) => {
      const { service, qb } = commentsSetup();
      await expect(service.list('u1', CARD, 10, cursor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(qb.getRawAndEntities).not.toHaveBeenCalled();
    });

    it('accepts the cursor card id in any letter case', async () => {
      const { service } = commentsSetup();
      await expect(
        service.list(
          'u1',
          CARD,
          10,
          cursorFor(CARD.toUpperCase(), '2026-10-27T10:00:00.000001', COMMENT),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('create', () => {
    it('stores an unsynced comment by the caller and announces card.commented', async () => {
      const { service, comments, publish } = commentsSetup();
      const snapshot = await service.create('u1', CARD, 'hello');
      expect(comments.create).toHaveBeenCalledWith({
        cardId: CARD,
        authorId: 'u1',
        text: 'hello',
        syncedToJira: false,
      });
      expect(snapshot).toMatchObject({ authorId: 'u1', text: 'hello', syncedToJira: false });
      expect(publish.mock.calls[0][0]).toMatchObject({
        type: 'card.commented',
        boardId: 'b1',
        actorId: 'u1',
      });
    });

    it('refuses a Viewer and answers 404 for an unknown card; nothing is saved', async () => {
      const viewer = commentsSetup(BoardRole.VIEWER);
      await expect(viewer.service.create('u1', CARD, 'x')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(viewer.comments.save).not.toHaveBeenCalled();
      const missing = commentsSetup();
      missing.cards.findOne.mockResolvedValue(null);
      await expect(missing.service.create('u1', CARD, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('markSynced', () => {
    it('marks and saves an existing comment, and ignores an unknown one', async () => {
      const found = commentsSetup();
      await found.service.markSynced(CARD, COMMENT);
      expect(found.comments.save).toHaveBeenCalledWith(
        expect.objectContaining({ syncedToJira: true }),
      );

      const missing = commentsSetup();
      missing.comments.findOne.mockResolvedValue(null);
      await missing.service.markSynced(CARD, COMMENT);
      expect(missing.comments.save).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('lets the author delete their comment and announces board.updated', async () => {
      const { service, comments, publish } = commentsSetup(BoardRole.MEMBER);
      comments.findOne.mockResolvedValue(comment({ authorId: 'u1' }));
      await service.delete('u1', CARD, COMMENT);
      expect(comments.remove).toHaveBeenCalled();
      expect(publish.mock.calls[0][0]).toMatchObject({ type: 'board.updated' });
    });

    it('lets an Admin delete anyone comment', async () => {
      const { service, comments } = commentsSetup(BoardRole.ADMIN);
      await service.delete('boss', CARD, COMMENT);
      expect(comments.remove).toHaveBeenCalled();
    });

    it('refuses a non-author non-admin, also a Viewer reading along', async () => {
      for (const role of [BoardRole.MEMBER, BoardRole.VIEWER]) {
        const { service, comments, publish } = commentsSetup(role);
        await expect(service.delete('other', CARD, COMMENT)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(comments.remove).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      }
    });

    it('answers 404 for an unknown card or comment', async () => {
      const noCard = commentsSetup();
      noCard.cards.findOne.mockResolvedValue(null);
      await expect(noCard.service.delete('u1', CARD, COMMENT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const noComment = commentsSetup();
      noComment.comments.findOne.mockResolvedValue(null);
      await expect(noComment.service.delete('u1', CARD, COMMENT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
