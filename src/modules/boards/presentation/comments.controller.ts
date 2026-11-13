import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth';
import { CommentsService } from '../application/comments.service';
import { CreateCommentDto } from './dto/comment.dto';

@ApiBearerAuth()
@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('cards/:cardId/comments')
  @ApiOperation({ summary: 'Comments of a card, oldest first' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  list(
    @CurrentUser('id') currentUserId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.comments.list(currentUserId, cardId, parsedLimit, cursor);
  }

  @Post('cards/:cardId/comments')
  @ApiOperation({ summary: 'Comment on a card' })
  create(
    @CurrentUser('id') currentUserId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(currentUserId, cardId, dto.text);
  }

  @Delete('cards/:cardId/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a comment (Author or Admin)' })
  delete(
    @CurrentUser('id') currentUserId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.comments.delete(currentUserId, cardId, commentId);
  }
}
