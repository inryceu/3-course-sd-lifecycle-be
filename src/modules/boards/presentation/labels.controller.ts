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
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth';
import { LabelsService } from '../application/labels.service';
import { CreateLabelDto, UpdateLabelDto } from './dto/label.dto';

@ApiBearerAuth()
@ApiTags('labels')
@Controller()
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('boards/:boardId/labels')
  @ApiOperation({ summary: 'Labels of a board' })
  list(@CurrentUser('id') currentUserId: string, @Param('boardId', ParseUUIDPipe) boardId: string) {
    return this.labels.list(currentUserId, boardId);
  }

  @Post('boards/:boardId/labels')
  @ApiOperation({ summary: 'Create a label' })
  create(
    @CurrentUser('id') currentUserId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() dto: CreateLabelDto,
  ) {
    return this.labels.create(currentUserId, boardId, dto.name, dto.color);
  }

  @Patch('labels/:labelId')
  @ApiOperation({ summary: 'Rename or recolour a label' })
  update(
    @CurrentUser('id') currentUserId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.labels.update(currentUserId, labelId, dto.name, dto.color);
  }

  @Delete('labels/:labelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a label' })
  delete(
    @CurrentUser('id') currentUserId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ) {
    return this.labels.delete(currentUserId, labelId);
  }

  @Put('cards/:cardId/labels/:labelId')
  @ApiOperation({ summary: 'Attach a label to a card' })
  attach(
    @CurrentUser('id') currentUserId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ) {
    return this.labels.attachToCard(currentUserId, cardId, labelId);
  }

  @Delete('cards/:cardId/labels/:labelId')
  @ApiOperation({ summary: 'Detach a label from a card' })
  detach(
    @CurrentUser('id') currentUserId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ) {
    return this.labels.detachFromCard(currentUserId, cardId, labelId);
  }
}
