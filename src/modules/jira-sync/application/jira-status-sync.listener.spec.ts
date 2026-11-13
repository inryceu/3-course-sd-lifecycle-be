import { Logger } from '@nestjs/common';
import { CardSnapshot, DomainEventOf } from '../../../common/events/domain-events';
import { JiraStatusSyncListener } from './jira-status-sync.listener';
import { JiraStatusSyncService } from './jira-status-sync.service';

function makeEvent(
  options: {
    issueKey?: string | null;
    fromColumnId?: string;
    toColumnId?: string;
    origin?: 'user' | 'jira';
  } = {},
): DomainEventOf<'card.moved'> {
  const toColumnId = options.toColumnId ?? 'col-done';
  const card: CardSnapshot = {
    id: 'card-1',
    boardId: 'b1',
    columnId: toColumnId,
    title: 'Card',
    description: null,
    deadline: null,
    jiraIssueKey: options.issueKey === undefined ? 'KAN-1' : options.issueKey,
    position: 0,
    assigneeId: null,
    labelIds: [],
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
  return {
    type: 'card.moved',
    boardId: 'b1',
    actorId: 'user-1',
    origin: options.origin ?? 'user',
    occurredAt: new Date().toISOString(),
    payload: {
      card,
      fromColumnId: options.fromColumnId ?? 'col-todo',
      toColumnId,
      position: 0,
    },
  };
}

function setup(result: Promise<void> = Promise.resolve()) {
  const sync = {
    syncCardMove: jest.fn().mockReturnValue(result),
  } as unknown as jest.Mocked<JiraStatusSyncService>;
  const listener = new JiraStatusSyncListener(sync);
  return { listener, sync };
}

describe('JiraStatusSyncListener', () => {
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('skips Jira-originated events', () => {
    const { listener, sync } = setup();

    listener.onCardMoved(makeEvent({ origin: 'jira' }));

    expect(sync.syncCardMove).not.toHaveBeenCalled();
  });

  it('skips same-column reorders', () => {
    const { listener, sync } = setup();

    listener.onCardMoved(makeEvent({ fromColumnId: 'col-todo', toColumnId: 'col-todo' }));

    expect(sync.syncCardMove).not.toHaveBeenCalled();
  });

  it('skips unlinked cards and logs a debug message', () => {
    const { listener, sync } = setup();

    listener.onCardMoved(makeEvent({ issueKey: null }));

    expect(sync.syncCardMove).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });

  it('starts the service without awaiting it', () => {
    let resolve: () => void = () => undefined;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    const { listener, sync } = setup(pending);
    const event = makeEvent();

    const result = listener.onCardMoved(event);

    expect(result).toBeUndefined();
    expect(sync.syncCardMove).toHaveBeenCalledWith(event);
    resolve();
  });

  it('logs unexpected service rejections', async () => {
    const { listener } = setup(Promise.reject(new Error('log write failed')));

    listener.onCardMoved(makeEvent());
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('log write failed'),
      expect.anything(),
    );
  });
});
