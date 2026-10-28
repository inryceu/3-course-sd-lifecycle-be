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
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { CommentEntity } from '../infrastructure/persistence/comment.entity';
import { BoardAccessService } from './board-access.service';

export const toCommentSnapshot = (c: CommentEntity): CommentSnapshot => ({
  id: c.id,
  cardId: c.cardId,
  authorId: c.authorId,
  text: c.text,
  syncedToJira: c.syncedToJira,
  createdAt: c.createdAt.toISOString(),
});

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(CommentEntity) private readonly comments: Repository<CommentEntity>,
    @InjectRepository(CardEntity) private readonly cards: Repository<CardEntity>,
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
      .where('c.cardId = :cardId', { cardId })
      .orderBy('c.createdAt', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .take(take + 1);

    if (cursor) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(cursor)) {
        throw new BadRequestException('Invalid cursor');
      }
      qb.andWhere(
        '(c."createdAt", c.id) > (SELECT x."createdAt", x.id FROM comments x WHERE x.id = :cursor)',
        { cursor },
      );
    }

    const results = await qb.getMany();
    const hasNext = results.length > take;
    const items = hasNext ? results.slice(0, take) : results;
    const nextCursor = hasNext ? items[items.length - 1].id : null;

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

    await this.events.publish(
      createEvent('board.updated', {
        boardId: card.boardId,
        actorId: userId,
        origin: 'user',
        payload: { id: card.boardId } as any,
      }),
    );
  }
}
