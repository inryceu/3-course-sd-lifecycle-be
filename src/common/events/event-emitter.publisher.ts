import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from './domain-events';
import { EventPublisher } from './event-publisher.port';

/**
 * `EventPublisher` on top of `@nestjs/event-emitter`.
 *
 * Every listener runs on its own so that one failing listener (sync throw or rejected promise)
 * neither fails the publisher's caller nor prevents the remaining listeners from running.
 */
@Injectable()
export class EventEmitterPublisher implements EventPublisher {
  private readonly logger = new Logger(EventEmitterPublisher.name);

  constructor(private readonly emitter: EventEmitter2) {}

  async publish(event: DomainEvent): Promise<void> {
    try {
      const listeners = this.emitter.listeners(event.type) as Array<(e: DomainEvent) => unknown>;
      const results = await Promise.allSettled(
        listeners.map((listener) => Promise.resolve().then(() => listener(event))),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          this.logFailure(event, result.reason);
        }
      }
    } catch (error) {
      this.logFailure(event, error);
    }
  }

  private logFailure(event: DomainEvent, reason: unknown): void {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    this.logger.error(
      `Listener failed for "${event.type}" on board ${event.boardId}: ${message}`,
      stack,
    );
  }
}
