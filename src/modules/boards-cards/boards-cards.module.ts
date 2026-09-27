import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { ColumnsController } from './columns.controller';
import { ColumnsService } from './columns.service';
import { Board } from './entities/board.entity';
import { Column } from './entities/column.entity';
import { Card } from './entities/card.entity';
import { Label } from './entities/label.entity';
import { Comment } from './entities/comment.entity';
import { BoardMembership } from './entities/board-membership.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Board, Column, Card, Label, Comment, BoardMembership]),
  ],
  controllers: [BoardsController, CardsController, ColumnsController],
  providers: [BoardsService, CardsService, ColumnsService],
  exports: [BoardsService, CardsService, ColumnsService],
})
export class BoardsCardsModule {}