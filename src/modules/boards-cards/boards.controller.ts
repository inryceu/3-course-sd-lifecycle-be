import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('boards')
@Controller('boards')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BoardsController {
  constructor(private boardsService: BoardsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new board' })
  @ApiResponse({ status: 201, description: 'Board created' })
  async create(@CurrentUser('id') userId: string, @Body() createBoardDto: CreateBoardDto) {
    return this.boardsService.create(userId, createBoardDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all boards for current user' })
  @ApiResponse({ status: 200, description: 'List of boards' })
  async findAll(@CurrentUser('id') userId: string) {
    return this.boardsService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get board by ID' })
  @ApiResponse({ status: 200, description: 'Board details' })
  @ApiResponse({ status: 404, description: 'Board not found' })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.boardsService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update board' })
  @ApiResponse({ status: 200, description: 'Board updated' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() updateBoardDto: UpdateBoardDto) {
    return this.boardsService.update(userId, id, updateBoardDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete board' })
  @ApiResponse({ status: 200, description: 'Board deleted' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.boardsService.remove(userId, id);
    return { message: 'Board deleted successfully' };
  }
}