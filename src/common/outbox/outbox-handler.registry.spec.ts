import { OutboxHandler } from './outbox-handler';
import { OutboxHandlerRegistry } from './outbox-handler.registry';

const handler = (operation: string): OutboxHandler =>
  ({ operation, handle: jest.fn() }) as unknown as OutboxHandler;

describe('OutboxHandlerRegistry', () => {
  it('starts empty, so an unknown operation has no handler', () => {
    const registry = new OutboxHandlerRegistry();
    expect(registry.get('TRANSITION_ISSUE')).toBeUndefined();
    expect(registry.has('TRANSITION_ISSUE')).toBe(false);
    expect(registry.operations()).toEqual([]);
  });

  it('returns the registered handler and lists operations sorted', () => {
    const registry = new OutboxHandlerRegistry();
    const transition = handler('TRANSITION_ISSUE');
    registry.register(handler('ADD_COMMENT'));
    registry.register(transition);
    expect(registry.get('TRANSITION_ISSUE')).toBe(transition);
    expect(registry.has('ADD_COMMENT')).toBe(true);
    expect(registry.operations()).toEqual(['ADD_COMMENT', 'TRANSITION_ISSUE']);
  });

  it('replaces the handler of an operation registered twice', () => {
    const registry = new OutboxHandlerRegistry();
    const second = handler('TRANSITION_ISSUE');
    registry.register(handler('TRANSITION_ISSUE'));
    registry.register(second);
    expect(registry.get('TRANSITION_ISSUE')).toBe(second);
  });
});
