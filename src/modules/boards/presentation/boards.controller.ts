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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth';
import { BoardsService } from '../application/boards.service';
import { BoardDetailView, BoardView } from '../application/views';
import { CreateBoardDto, UpdateBoardDto } from './dto/board.dto';

@ApiTags('boards')
@ApiBearerAuth()
@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a board with default columns; the creator becomes Admin' })
  @ApiResponse({ status: 201 })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateBoardDto): Promise<BoardDetailView> {
    return this.boards.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Boards the user belongs to' })
  list(@CurrentUser('id') userId: string): Promise<BoardView[]> {
    return this.boards.list(userId);
  }

  @Get(':boardId')
  @ApiOperation({ summary: 'Board with ordered columns and their ordered cards' })
  get(
    @CurrentUser('id') userId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ): Promise<BoardDetailView> {
    return this.boards.get(userId, boardId);
  }

  @Patch(':boardId')
  @ApiOperation({ summary: 'Update board settings (Admin)' })
  update(
    @CurrentUser('id') userId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() dto: UpdateBoardDto,
  ): Promise<BoardView> {
    return this.boards.update(userId, boardId, dto);
  }

  @Delete(':boardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete the board and everything it owns (Admin)' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ): Promise<void> {
    return this.boards.remove(userId, boardId);
  }
}
