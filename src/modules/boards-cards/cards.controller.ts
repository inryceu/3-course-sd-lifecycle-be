import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CardsService } from './cards.service';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('cards')
@Controller('cards')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CardsController {
  constructor(private cardsService: CardsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new card' })
  @ApiResponse({ status: 201, description: 'Card created' })
  async create(@CurrentUser('id') userId: string, @Body() createCardDto: CreateCardDto) {
    return this.cardsService.create(userId, createCardDto.columnId.split('-')[0], createCardDto);
  }

  @Get('column/:columnId')
  @ApiOperation({ summary: 'Get all cards in a column' })
  @ApiResponse({ status: 200, description: 'List of cards' })
  async findByColumn(@CurrentUser('id') userId: string, @Param('columnId') columnId: string) {
    return this.cardsService.findByColumn(userId, columnId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get card by ID' })
  @ApiResponse({ status: 200, description: 'Card details' })
  @ApiResponse({ status: 404, description: 'Card not found' })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.cardsService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update card' })
  @ApiResponse({ status: 200, description: 'Card updated' })
  async update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() updateCardDto: UpdateCardDto) {
    return this.cardsService.update(userId, id, updateCardDto);
  }

  @Patch(':id/move')
  @ApiOperation({ summary: 'Move card to another column/position' })
  @ApiResponse({ status: 200, description: 'Card moved' })
  async move(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body('columnId') columnId: string,
    @Body('position') position: number,
  ) {
    return this.cardsService.move(userId, id, columnId, position);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete card' })
  @ApiResponse({ status: 200, description: 'Card deleted' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.cardsService.remove(userId, id);
    return { message: 'Card deleted successfully' };
  }
}