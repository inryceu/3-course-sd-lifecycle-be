import { DomainEventOf } from '../../../common/events/domain-events';
import { OutboxWorker } from '../../../common/outbox/outbox.worker';
import { JiraStatusSyncListener } from './jira-status-sync.listener';

describe('JiraStatusSyncListener', () => {
  const kick = jest.fn();
  const listener = new JiraStatusSyncListener({ kick } as unknown as OutboxWorker);
  const event = (origin: string) => ({ origin }) as unknown as DomainEventOf<'card.moved'>;

  beforeEach(() => kick.mockClear());

  it('wakes the outbox worker after a user move', () => {
    listener.onCardMoved(event('user'));
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it('ignores moves that originate from Jira', () => {
    listener.onCardMoved(event('jira'));
    expect(kick).not.toHaveBeenCalled();
  });
});
