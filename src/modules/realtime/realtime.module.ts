import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { BoardEventsListener } from './application/board-events.listener';
import { RealtimeGateway } from './presentation/realtime.gateway';

/**
 * Depends only on the shared event bus, the shared `BOARD_ACCESS` port and `AUTH_FACADE`.
 * It never imports the boards module.
 */
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, BoardEventsListener],
})
export class RealtimeModule {}
