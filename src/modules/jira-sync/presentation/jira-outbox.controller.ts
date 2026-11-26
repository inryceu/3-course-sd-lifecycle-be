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
  JiraOutboxAdminService,
  OutboxPageView,
  OutboxRequeueSummary,
  OutboxRowView,
} from '../application/jira-outbox-admin.service';
import { OutboxBoardQueryDto, OutboxListQueryDto } from './dto/jira-outbox.dto';

@ApiTags('jira')
@ApiBearerAuth()
@Controller('jira/sync/outbox')
export class JiraOutboxController {
  constructor(private readonly admin: JiraOutboxAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Jira sync outbox rows of a board, default DEAD (Admin)' })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: OutboxListQueryDto,
  ): Promise<OutboxPageView> {
    return this.admin.list(userId, query.boardId, query.status, query.limit, query.cursor);
  }

  @Post('requeue-dead')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Requeue every dead outbox row of a board that is not blocked (Admin)' })
  requeueDead(
    @CurrentUser('id') userId: string,
    @Query() query: OutboxBoardQueryDto,
  ): Promise<OutboxRequeueSummary> {
    return this.admin.requeueDead(userId, query.boardId);
  }

  @Post(':outboxId/requeue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Requeue a dead outbox row (Admin)' })
  requeue(
    @CurrentUser('id') userId: string,
    @Param('outboxId', ParseUUIDPipe) outboxId: string,
  ): Promise<OutboxRowView> {
    return this.admin.requeue(userId, outboxId);
  }
}
