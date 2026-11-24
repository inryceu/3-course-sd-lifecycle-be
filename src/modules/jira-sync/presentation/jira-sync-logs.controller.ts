import {
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
  JiraSyncLogsService,
  RetryResult,
  SyncLogPageView,
} from '../application/jira-sync-logs.service';
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

  @Post(':logId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a failed sync log (Admin)',
    description:
      'Retries a failed outbound status move or comment sync. Only logs with status FAILED and outcome !== unknown can be retried.',
  })
  retry(
    @CurrentUser('id') userId: string,
    @Param('logId', ParseUUIDPipe) logId: string,
  ): Promise<RetryResult> {
    return this.syncLogs.retry(userId, logId);
  }
}
