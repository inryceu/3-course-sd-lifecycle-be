import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncOutboxEntity } from './infrastructure/persistence/sync-outbox.entity';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { OUTBOX_CLOCK, OUTBOX_CONFIG, loadOutboxConfig, systemClock } from './outbox.config';
import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SyncOutboxEntity])],
  providers: [
    { provide: OUTBOX_CONFIG, useFactory: () => loadOutboxConfig() },
    { provide: OUTBOX_CLOCK, useValue: systemClock },
    OutboxHandlerRegistry,
    OutboxService,
    OutboxWorker,
  ],
  exports: [OutboxService, OutboxHandlerRegistry, OutboxWorker, OUTBOX_CONFIG, OUTBOX_CLOCK],
})
export class OutboxModule {}
