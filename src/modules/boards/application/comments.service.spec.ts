import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { EventPublisher } from '../../../common/events';
import { BoardRole } from '../domain/board-role';
import { CardEntity } from '../infrastructure/persistence/card.entity';
import { CommentEntity } from '../infrastructure/persistence/comment.entity';
import { BoardAccessService } from './board-access.service';
import { CommentsService } from './comments.service';

const events = (): EventPublisher & { publish: jest.Mock } => ({ publish: jest.fn() });

const access = (role: BoardRole | null) =>
  ({
    requireEditor: jest.fn().mockResolvedValue(role),
    requireMember: jest.fn().mockResolvedValue(role),
    getRole: jest.fn().mockResolvedValue(role),
  }) as unknown as BoardAccessService;

const repo = <T extends object>(methods: Record<string, unknown>) =>
  methods as unknown as Repository<T>;

describe('CommentsService', () => {
  it('creates a comment and publishes card.commented', async () => {
    const publisher = events();
    const cards = repo<CardEntity>({
      findOne: jest.fn().mockResolvedValue({ id: 'c1', boardId: 'b1' }),
    });
    const comments = repo<CommentEntity>({
      create: jest.fn().mockReturnValue({ id: 'cm1', text: 'Hi', createdAt: new Date() }),
      save: jest.fn().mockResolvedValue({ id: 'cm1', text: 'Hi', createdAt: new Date() }),
    });

    const service = new CommentsService(comments, cards, access(BoardRole.MEMBER), publisher);
    const result = await service.create('u1', 'c1', 'Hi');

    expect(result.id).toBe('cm1');
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'card.commented', origin: 'user' }),
    );
  });

  it('allows the author to delete their comment', async () => {
    const cards = repo<CardEntity>({
      findOne: jest.fn().mockResolvedValue({ id: 'c1', boardId: 'b1' }),
    });
    const comments = repo<CommentEntity>({
      findOne: jest.fn().mockResolvedValue({ id: 'cm1', authorId: 'u1' }),
      remove: jest.fn().mockResolvedValue(undefined),
    });

    const service = new CommentsService(comments, cards, access(BoardRole.MEMBER), events());
    await expect(service.delete('u1', 'c1', 'cm1')).resolves.toBeUndefined();
  });

  it('prevents non-authors from deleting a comment if not admin', async () => {
    const cards = repo<CardEntity>({
      findOne: jest.fn().mockResolvedValue({ id: 'c1', boardId: 'b1' }),
    });
    const comments = repo<CommentEntity>({
      findOne: jest.fn().mockResolvedValue({ id: 'cm1', authorId: 'u2' }),
    });

    const service = new CommentsService(comments, cards, access(BoardRole.MEMBER), events());
    await expect(service.delete('u1', 'c1', 'cm1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFoundException if the user is not a member of the board', async () => {
    const cards = repo<CardEntity>({
      findOne: jest.fn().mockResolvedValue({ id: 'c1', boardId: 'b1' }),
    });
    const comments = repo<CommentEntity>({
      findOne: jest.fn().mockResolvedValue({ id: 'cm1', authorId: 'u1' }),
    });
    const accessMock = access(null);
    accessMock.requireMember = jest.fn().mockRejectedValue(new NotFoundException());

    const service = new CommentsService(comments, cards, accessMock, events());
    await expect(service.delete('u1', 'c1', 'cm1')).rejects.toBeInstanceOf(NotFoundException);
    expect(accessMock.requireMember).toHaveBeenCalledWith('u1', 'b1');
  });
});
