import { Injectable } from '@nestjs/common';
import { OutboxHandler } from './outbox-handler';

/**
 * Maps `sync_outbox.operation` to the handler that performs it. The registry starts empty;
 * a module registers its handlers from `onModuleInit` (T-35 registers `TRANSITION_ISSUE`), so an
 * unknown operation is a permanent `handler_missing` dead letter instead of a crash.
 */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  /** Registers (or replaces) the handler for one operation. */
  register(handler: OutboxHandler): void {
    this.handlers.set(handler.operation, handler);
  }

  get(operation: string): OutboxHandler | undefined {
    return this.handlers.get(operation);
  }

  has(operation: string): boolean {
    return this.handlers.has(operation);
  }

  /** Registered operations, sorted; used for diagnostics and tests. */
  operations(): string[] {
    return [...this.handlers.keys()].sort();
  }
}
