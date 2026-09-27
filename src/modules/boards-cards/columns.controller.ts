import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ColumnsService } from './columns.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('columns')
@Controller('columns')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ColumnsController {
  constructor(private columnsService: ColumnsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new column' })
  @ApiResponse({ status: 201, description: 'Column created' })
  async create(@CurrentUser('id') userId: string, @Body() createColumnDto: CreateColumnDto) {
    return this.columnsService.create(userId, createColumnDto);
  }

  @Get('board/:boardId')
  @ApiOperation({ summary: 'Get all columns for a board' })
  @ApiResponse({ status: 200, description: 'List of columns with cards' })
  async findByBoard(@CurrentUser('id') userId: string, @Param('boardId') boardId: string) {
    return this.columnsService.findByBoard(userId, boardId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update column' })
  @ApiResponse({ status: 200, description: 'Column updated' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() updateColumnDto: UpdateColumnDto,
  ) {
    return this.columnsService.update(userId, id, updateColumnDto);
  }

  @Patch(':id/reorder')
  @ApiOperation({ summary: 'Reorder column' })
  @ApiResponse({ status: 200, description: 'Column reordered' })
  async reorder(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body('position') position: number,
  ) {
    return this.columnsService.reorder(userId, id, position);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete column' })
  @ApiResponse({ status: 200, description: 'Column deleted' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.columnsService.remove(userId, id);
    return { message: 'Column deleted successfully' };
  }
}
