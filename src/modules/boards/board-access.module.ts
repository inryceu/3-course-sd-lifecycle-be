import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BOARD_ACCESS } from '../../common/ports';
import { BoardAccessService } from './application/board-access.service';
import { BoardMembershipEntity } from './infrastructure/persistence/board-membership.entity';

/**
 * Global provider of the membership-based ports. Being global lets `realtime` and `jira-sync`
 * inject `BOARD_ACCESS` / `BOARDS_FACADE` without importing the boards module (and so without
 * depending on its internals).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([BoardMembershipEntity])],
  providers: [BoardAccessService, { provide: BOARD_ACCESS, useExisting: BoardAccessService }],
  exports: [BoardAccessService, BOARD_ACCESS],
})
export class BoardAccessModule {}
