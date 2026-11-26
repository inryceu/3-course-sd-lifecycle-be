import { SyncOutboxEntity } from '../../../common/outbox/infrastructure/persistence/sync-outbox.entity';
import { BoardRole } from '../../boards';
import { JiraOutboxDeadLetterListener } from './jira-outbox-dead-letter.listener';

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: 'o1',
    boardId: 'b1',
    cardId: 'c1',
    operation: 'TRANSITION_ISSUE',
    actorId: 'mover',
    attempts: 12,
    errorCode: 'attempts_exhausted',
    payload: { jiraIssueKey: 'KAN-1' },
    ...over,
  }) as unknown as SyncOutboxEntity;

function setup(role: BoardRole | null = BoardRole.MEMBER) {
  const worker = { onDeadLettered: jest.fn() };
  const boards = {
    notifyBoardAdmins: jest.fn().mockResolvedValue(2),
    notifyUser: jest.fn().mockResolvedValue(1),
    getMemberRole: jest.fn().mockResolvedValue(role),
  };
  const listener = new JiraOutboxDeadLetterListener(worker as never, boards as never);
  return { listener, worker, boards };
}

describe('JiraOutboxDeadLetterListener', () => {
  it('subscribes to dead letters on module init', () => {
    const { listener, worker } = setup();
    listener.onModuleInit();
    expect(worker.onDeadLettered).toHaveBeenCalledTimes(1);
  });

  it('notifies the Admins and a Member who made the move', async () => {
    const { listener, boards } = setup();
    await listener.notify(row());
    expect(boards.notifyBoardAdmins).toHaveBeenCalledWith('b1', 'jira.sync.failed', {
      outboxId: 'o1',
      boardId: 'b1',
      cardId: 'c1',
      jiraIssueKey: 'KAN-1',
      operation: 'TRANSITION_ISSUE',
      attempts: 12,
      errorCode: 'attempts_exhausted',
    });
    expect(boards.notifyUser).toHaveBeenCalledWith(
      'mover',
      'b1',
      'jira.sync.failed',
      expect.any(Object),
    );
  });

  it('does not notify an Admin mover twice, nor a mover who left the board', async () => {
    const admin = setup(BoardRole.ADMIN);
    await admin.listener.notify(row());
    expect(admin.boards.notifyUser).not.toHaveBeenCalled();
    const gone = setup(null);
    await gone.listener.notify(row());
    expect(gone.boards.notifyUser).not.toHaveBeenCalled();
  });

  it('ignores other operations and rows without an actor', async () => {
    const { listener, boards } = setup();
    await listener.notify(row({ operation: 'ADD_COMMENT' }));
    expect(boards.notifyBoardAdmins).not.toHaveBeenCalled();
    await listener.notify(row({ actorId: null }));
    expect(boards.notifyUser).not.toHaveBeenCalled();
  });

  it('never throws when a notification fails', async () => {
    const { listener, boards } = setup();
    boards.notifyBoardAdmins.mockRejectedValue(new Error('db down'));
    await expect(listener.notify(row())).resolves.toBeUndefined();
  });
});
