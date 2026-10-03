import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventEmitterPublisher } from './event-emitter.publisher';
import { EVENT_PUBLISHER } from './event-publisher.port';

/** Global event bus. Modules inject `EVENT_PUBLISHER` and subscribe with `@OnEvent`. */
@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [{ provide: EVENT_PUBLISHER, useClass: EventEmitterPublisher }],
  exports: [EVENT_PUBLISHER],
})
export class EventBusModule {}
