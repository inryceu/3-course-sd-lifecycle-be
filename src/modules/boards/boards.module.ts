import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth';
import { BoardAccessModule } from './board-access.module';
import { BoardsService } from './application/boards.service';
import { CardsService } from './application/cards.service';
import { ColumnsService } from './application/columns.service';
import { BoardsFacadeService } from './application/boards-facade.service';
import { BOARDS_FACADE } from './application/boards-facade.port';
import { BoardMembershipEntity } from './infrastructure/persistence/board-membership.entity';
import { BoardEntity } from './infrastructure/persistence/board.entity';
import { CardEntity } from './infrastructure/persistence/card.entity';
import { CommentEntity } from './infrastructure/persistence/comment.entity';
import { BoardColumnEntity } from './infrastructure/persistence/column.entity';
import { LabelEntity } from './infrastructure/persistence/label.entity';
import { BoardsController } from './presentation/boards.controller';
import { CardsController } from './presentation/cards.controller';
import { ColumnsController } from './presentation/columns.controller';
import { MembersController } from './presentation/members.controller';
import { MembersService } from './application/members.service';
import { DeadlineRemindersService } from './application/deadline-reminders.service';
import { NotificationsService } from './application/notifications.service';
import { NotificationEntity } from './infrastructure/persistence/notification.entity';
import { NotificationsController } from './presentation/notifications.controller';

@Module({
  imports: [
    // boards -> auth: identity comes from the global guard and AUTH_FACADE, never from auth tables.
    AuthModule,
    BoardAccessModule,
    // Entities are registered by the module that owns them.
    TypeOrmModule.forFeature([
      BoardEntity,
      BoardColumnEntity,
      CardEntity,
      LabelEntity,
      CommentEntity,
      BoardMembershipEntity,
      NotificationEntity,
    ]),
  ],
  controllers: [
    BoardsController,
    ColumnsController,
    CardsController,
    MembersController,
    NotificationsController,
  ],
  providers: [
    BoardsService,
    ColumnsService,
    CardsService,
    MembersService,
    NotificationsService,
    DeadlineRemindersService,
    BoardsFacadeService,
    { provide: BOARDS_FACADE, useExisting: BoardsFacadeService },
  ],
  exports: [BOARDS_FACADE],
})
export class BoardsModule {}
