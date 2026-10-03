import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createEvent, DOMAIN_EVENT_TYPES, DomainEvent } from './domain-events';
import { EventEmitterPublisher } from './event-emitter.publisher';

const cardSnapshot = {
  id: 'c1',
  boardId: 'b1',
  columnId: 'col1',
  title: 'Card',
  description: null,
  deadline: null,
  jiraIssueKey: null,
  position: 0,
  assigneeId: null,
  labelIds: [],
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
};

const sampleEvent = (): DomainEvent =>
  createEvent('card.created', { boardId: 'b1', actorId: 'u1', payload: cardSnapshot });

describe('createEvent', () => {
  it('carries board, actor, origin and timestamp', () => {
    const at = new Date('2026-10-03T10:00:00.000Z');
    const event = createEvent('card.moved', {
      boardId: 'b1',
      actorId: 'u1',
      occurredAt: at,
      payload: { card: cardSnapshot, fromColumnId: 'a', toColumnId: 'b', position: 2 },
    });
    expect(event).toMatchObject({
      type: 'card.moved',
      boardId: 'b1',
      actorId: 'u1',
      origin: 'user',
      occurredAt: '2026-10-03T10:00:00.000Z',
    });
  });

  it('marks events that come from Jira', () => {
    const event = createEvent('card.updated', {
      boardId: 'b1',
      origin: 'jira',
      payload: cardSnapshot,
    });
    expect(event.origin).toBe('jira');
    expect(event.actorId).toBeUndefined();
  });

  it('defines exactly the contract event names', () => {
    expect([...DOMAIN_EVENT_TYPES].sort()).toEqual(
      [
        'board.updated',
        'card.commented',
        'card.created',
        'card.moved',
        'card.updated',
        'notification.created',
      ].sort(),
    );
  });
});

describe('EventEmitterPublisher', () => {
  let emitter: EventEmitter2;
  let publisher: EventEmitterPublisher;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    emitter = new EventEmitter2();
    publisher = new EventEmitterPublisher(emitter);
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('delivers an event to every subscriber of its type', async () => {
    const first = jest.fn();
    const second = jest.fn();
    emitter.on('card.created', first);
    emitter.on('card.created', second);
    const event = sampleEvent();

    await publisher.publish(event);

    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
  });

  it('does not deliver events to subscribers of other types', async () => {
    const other = jest.fn();
    emitter.on('card.moved', other);
    await publisher.publish(sampleEvent());
    expect(other).not.toHaveBeenCalled();
  });

  it('does not reject when a listener rejects, logs it and still runs the others', async () => {
    const healthy = jest.fn();
    emitter.on('card.created', (() => Promise.reject(new Error('boom'))) as () => void);
    emitter.on('card.created', healthy);

    await expect(publisher.publish(sampleEvent())).resolves.toBeUndefined();

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('boom'), expect.anything());
  });

  it('does not reject when a listener throws synchronously and still runs the others', async () => {
    const healthy = jest.fn();
    emitter.on('card.created', () => {
      throw new Error('sync failure');
    });
    emitter.on('card.created', healthy);

    await expect(publisher.publish(sampleEvent())).resolves.toBeUndefined();

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('sync failure'),
      expect.anything(),
    );
  });

  it('resolves when nobody listens', async () => {
    await expect(publisher.publish(sampleEvent())).resolves.toBeUndefined();
  });
});
