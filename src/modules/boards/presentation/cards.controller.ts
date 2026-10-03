import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth';
import { CardsService } from '../application/cards.service';
import { CardView } from '../application/views';
import { CreateCardDto, MoveCardDto, UpdateCardDto } from './dto/card.dto';

@ApiTags('cards')
@ApiBearerAuth()
@Controller()
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get('columns/:columnId/cards')
  @ApiOperation({ summary: 'Cards of a column ordered by position' })
  list(
    @CurrentUser('id') userId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
  ): Promise<CardView[]> {
    return this.cards.listByColumn(userId, columnId);
  }

  @Post('columns/:columnId/cards')
  @ApiOperation({ summary: 'Create a card at the end of the column (Member, Admin)' })
  create(
    @CurrentUser('id') userId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body() dto: CreateCardDto,
  ): Promise<CardView> {
    return this.cards.create(userId, columnId, dto);
  }

  @Get('cards/:cardId')
  @ApiOperation({ summary: 'Card' })
  get(
    @CurrentUser('id') userId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
  ): Promise<CardView> {
    return this.cards.get(userId, cardId);
  }

  @Patch('cards/:cardId')
  @ApiOperation({ summary: 'Update card fields (Member, Admin)' })
  update(
    @CurrentUser('id') userId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: UpdateCardDto,
  ): Promise<CardView> {
    return this.cards.update(userId, cardId, dto);
  }

  @Patch('cards/:cardId/move')
  @ApiOperation({ summary: 'Move a card to a column of the same board (Member, Admin)' })
  move(
    @CurrentUser('id') userId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: MoveCardDto,
  ): Promise<CardView> {
    return this.cards.move(userId, cardId, dto);
  }

  @Delete('cards/:cardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a card (Member, Admin)' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
  ): Promise<void> {
    return this.cards.remove(userId, cardId);
  }
}
