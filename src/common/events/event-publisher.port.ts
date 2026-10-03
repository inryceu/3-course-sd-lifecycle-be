import { DomainEvent } from './domain-events';

/**
 * Publisher port for domain events.
 *
 * Usage rules:
 * - Events are only for fan-out of "something changed" notifications (realtime, Jira sync).
 *   Anything that needs a result is a direct call through an exported port.
 * - Publish only after the database change has been committed (after `save()` or after the
 *   transaction callback resolved), never inside a transaction.
 * - `publish` never rejects: a failing listener is logged and cannot fail the caller.
 */
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
