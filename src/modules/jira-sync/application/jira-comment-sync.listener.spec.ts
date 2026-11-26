import { Logger } from '@nestjs/common';
import { CommentSnapshot, DomainEventOf } from '../../../common/events/domain-events';
import { JiraCommentSyncListener } from './jira-comment-sync.listener';
import { JiraCommentSyncService } from './jira-comment-sync.service';

function makeEvent(options: { origin?: 'user' | 'jira' } = {}): DomainEventOf<'card.commented'> {
  const payload: CommentSnapshot = {
    id: 'comment-1',
    cardId: 'card-1',
    authorId: 'user-1',
    text: 'Looks good',
    syncedToJira: false,
    createdAt: '2026-10-01T10:00:00.000Z',
  };
  return {
    type: 'card.commented',
    boardId: 'board-1',
    actorId: 'user-1',
    origin: options.origin ?? 'user',
    occurredAt: new Date().toISOString(),
    payload,
  };
}

function setup(result: Promise<void> = Promise.resolve()) {
  const sync = {
    syncComment: jest.fn().mockReturnValue(result),
  } as unknown as jest.Mocked<JiraCommentSyncService>;
  const listener = new JiraCommentSyncListener(sync);
  return { listener, sync };
}

describe('JiraCommentSyncListener', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('starts the service without awaiting it', () => {
    let resolve: () => void = () => undefined;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    const { listener, sync } = setup(pending);
    const event = makeEvent();

    const result = listener.onCardCommented(event);

    expect(result).toBeUndefined();
    expect(sync.syncComment).toHaveBeenCalledWith(event);
    resolve();
  });

  it('logs unexpected service rejections', async () => {
    const { listener } = setup(Promise.reject(new Error('log write failed')));

    listener.onCardCommented(makeEvent());
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('log write failed'),
      expect.anything(),
    );
  });
});
