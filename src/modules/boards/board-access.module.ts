import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BOARD_ACCESS } from '../../common/ports';
import { BoardAccessService } from './application/board-access.service';
import { BOARDS_FACADE } from './application/boards-facade.port';
import { BoardsFacadeService } from './application/boards-facade.service';
import { BoardMembershipEntity } from './infrastructure/persistence/board-membership.entity';

/**
 * Global provider of the membership-based ports. Being global lets `realtime` and `jira-sync`
 * inject `BOARD_ACCESS` / `BOARDS_FACADE` without importing the boards module (and so without
 * depending on its internals).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([BoardMembershipEntity])],
  providers: [
    BoardAccessService,
    BoardsFacadeService,
    { provide: BOARDS_FACADE, useExisting: BoardsFacadeService },
    { provide: BOARD_ACCESS, useExisting: BoardsFacadeService },
  ],
  exports: [BoardAccessService, BOARDS_FACADE, BOARD_ACCESS],
})
export class BoardAccessModule {}
