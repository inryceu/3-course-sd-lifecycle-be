import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth';
import { JiraSyncLogsService, SyncLogPageView } from '../application/jira-sync-logs.service';
import { ListSyncLogsQueryDto } from './dto/jira.dto';
import { SyncStatus } from '../infrastructure/persistence/sync-log.entity';

@ApiTags('jira')
@ApiBearerAuth()
@Controller('jira/sync-logs')
export class JiraSyncLogsController {
  constructor(private readonly syncLogs: JiraSyncLogsService) {}

  @Get()
  @ApiOperation({
    summary: 'Sync logs of a board, newest first (Admin)',
    description:
      'Returns paginated sync logs with optional status filter. Cursor-based pagination.',
  })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListSyncLogsQueryDto,
  ): Promise<SyncLogPageView> {
    return this.syncLogs.list(
      userId,
      query.boardId,
      query.limit,
      query.cursor,
      query.status as SyncStatus | undefined,
    );
  }
}
