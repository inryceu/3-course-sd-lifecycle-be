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
import { ColumnsService } from '../application/columns.service';
import { ColumnView } from '../application/views';
import { CreateColumnDto, ReorderColumnDto, UpdateColumnDto } from './dto/column.dto';

@ApiTags('columns')
@ApiBearerAuth()
@Controller()
export class ColumnsController {
  constructor(private readonly columns: ColumnsService) {}

  @Get('boards/:boardId/columns')
  @ApiOperation({ summary: 'Columns of a board ordered by position' })
  list(
    @CurrentUser('id') userId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ): Promise<ColumnView[]> {
    return this.columns.list(userId, boardId);
  }

  @Post('boards/:boardId/columns')
  @ApiOperation({ summary: 'Add a column (Admin)' })
  create(
    @CurrentUser('id') userId: string,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() dto: CreateColumnDto,
  ): Promise<ColumnView> {
    return this.columns.create(userId, boardId, dto);
  }

  @Patch('columns/:columnId')
  @ApiOperation({ summary: 'Rename or retype a column (Admin)' })
  update(
    @CurrentUser('id') userId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body() dto: UpdateColumnDto,
  ): Promise<ColumnView> {
    return this.columns.update(userId, columnId, dto);
  }

  @Delete('columns/:columnId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an empty column while at least three remain (Admin)' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
  ): Promise<void> {
    return this.columns.remove(userId, columnId);
  }

  @Patch('columns/:columnId/reorder')
  @ApiOperation({ summary: 'Move a column to a position (Admin, transactional)' })
  reorder(
    @CurrentUser('id') userId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body() dto: ReorderColumnDto,
  ): Promise<ColumnView[]> {
    return this.columns.reorder(userId, columnId, dto.position);
  }
}
