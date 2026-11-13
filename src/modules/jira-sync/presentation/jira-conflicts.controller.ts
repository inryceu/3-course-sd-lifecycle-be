import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth';
import {
  ConflictPageView,
  ConflictView,
  JiraSyncConflictsService,
} from '../application/jira-sync-conflicts.service';
import { ListConflictsQueryDto, ResolveConflictDto } from './dto/jira.dto';

@ApiTags('jira')
@ApiBearerAuth()
@Controller('jira/conflicts')
export class JiraConflictsController {
  constructor(private readonly conflicts: JiraSyncConflictsService) {}

  @Get()
  @ApiOperation({ summary: 'Logged synchronisation conflicts of a board, newest first (Admin)' })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListConflictsQueryDto,
  ): Promise<ConflictPageView> {
    return this.conflicts.list(userId, query.boardId, query.limit, query.cursor);
  }

  @Post(':conflictId/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Keep the Jira version or push the BoardSync version (Admin)' })
  resolve(
    @CurrentUser('id') userId: string,
    @Param('conflictId', ParseUUIDPipe) conflictId: string,
    @Body() dto: ResolveConflictDto,
  ): Promise<ConflictView> {
    return this.conflicts.resolve(userId, conflictId, dto.resolution);
  }
}
