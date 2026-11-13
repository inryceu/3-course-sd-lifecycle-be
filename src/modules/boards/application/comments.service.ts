import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CommentSnapshot,
  EVENT_PUBLISHER,
  EventPublisher,
  createEvent,
} from '../../../common/events';
import { BoardRole } from '../domain/board-role';
import { BoardEntity } from '../infrastructure/persistence/board.entity';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { CommentEntity } from '../infrastructure/persistence/comment.entity';
import { BoardAccessService } from './board-access.service';
import { toBoardSnapshot } from './board-events';

export const toCommentSnapshot = (c: CommentEntity): CommentSnapshot => ({
  id: c.id,
  cardId: c.cardId,
  authorId: c.authorId,
  text: c.text,
  syncedToJira: c.syncedToJira,
  createdAt: c.createdAt.toISOString(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;
/** `createdAt` in UTC with microseconds, as text from Postgres: a JS Date would drop them. */
const CREATED_AT_TEXT = `to_char(c."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/** The cursor is a position (card, createdAt, id), so it survives deletion of its comment. */
const encodeCursor = (cardId: string, ts: string, id: string): string =>
  Buffer.from(`${cardId}|${ts}|${id}`).toString('base64url');

function decodeCursor(cursor: string, cardId: string): { ts: string; id: string } {
  const [card, ts = '', id = '', ...rest] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|');
  // the round trip rejects dates like 2026-02-30 or 2026-13-01, which Postgres would answer with a 500
  const date = new Date(`${ts}Z`);
  const valid =
    rest.length === 0 &&
    card?.toLowerCase() === cardId.toLowerCase() &&
    UUID.test(id) &&
    CURSOR_TS.test(ts) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 23) === ts.slice(0, 23);
  if (!valid) throw new BadRequestException('Invalid cursor');
  return { ts, id };
}

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(CommentEntity) private readonly comments: Repository<CommentEntity>,
    @InjectRepository(CardEntity) private readonly cards: Repository<CardEntity>,
    @InjectRepository(BoardEntity) private readonly boards: Repository<BoardEntity>,
    private readonly access: BoardAccessService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
  ) {}

  async list(userId: string, cardId: string, limit: number = 50, cursor?: string) {
    const card = await this.cards.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card not found');
    await this.access.requireMember(userId, card.boardId);

    const take = limit > 0 && limit <= 100 ? limit : 50;

    const qb = this.comments
      .createQueryBuilder('c')
      .addSelect(CREATED_AT_TEXT, 'cursor_ts')
      .where('c.cardId = :cardId', { cardId: card.id })
      .orderBy('c.createdAt', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .limit(take + 1);

    if (cursor) {
      const { ts, id } = decodeCursor(cursor, card.id);
      qb.andWhere(`(c."createdAt", c.id) > ((:ts)::timestamp AT TIME ZONE 'UTC', (:id)::uuid)`, {
        ts,
        id,
      });
    }

    const { entities, raw } = await qb.getRawAndEntities<{ cursor_ts: string }>();
    const hasNext = entities.length > take;
    const items = hasNext ? entities.slice(0, take) : entities;
    const nextCursor = hasNext
      ? encodeCursor(card.id, raw[take - 1].cursor_ts, items[take - 1].id)
      : null;

    return {
      items: items.map(toCommentSnapshot),
      nextCursor,
    };
  }

  async create(userId: string, cardId: string, text: string): Promise<CommentSnapshot> {
    const card = await this.cards.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card not found');
    await this.access.requireEditor(userId, card.boardId);

    const comment = this.comments.create({
      cardId,
      authorId: userId,
      text,
      syncedToJira: false,
    });
    const saved = await this.comments.save(comment);
    const snapshot = toCommentSnapshot(saved);

    await this.events.publish(
      createEvent('card.commented', {
        boardId: card.boardId,
        actorId: userId,
        origin: 'user',
        payload: snapshot,
      }),
    );

    return snapshot;
  }

  async delete(userId: string, cardId: string, commentId: string): Promise<void> {
    const card = await this.cards.findOne({ where: { id: cardId } });
    if (!card) throw new NotFoundException('Card not found');

    const role = await this.access.requireMember(userId, card.boardId);

    const comment = await this.comments.findOne({ where: { id: commentId, cardId } });
    if (!comment) throw new NotFoundException('Comment not found');

    if (role !== BoardRole.ADMIN && comment.authorId !== userId) {
      throw new ForbiddenException('Only the author or an admin can delete this comment');
    }

    await this.comments.remove(comment);
    const board = await this.boards.findOneOrFail({ where: { id: card.boardId } });

    await this.events.publish(
      createEvent('board.updated', {
        boardId: card.boardId,
        actorId: userId,
        origin: 'user',
        payload: { board: toBoardSnapshot(board) },
      }),
    );
  }
}
