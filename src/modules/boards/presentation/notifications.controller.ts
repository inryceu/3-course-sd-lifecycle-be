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
import { NotificationsService } from '../application/notifications.service';
import { NotificationPageView, NotificationView } from '../application/views';
import { ListNotificationsQueryDto } from './dto/notification.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'In-app notifications of the current user, newest first' })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationPageView> {
    return this.notifications.list(userId, query.limit, query.cursor);
  }

  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(
    @CurrentUser('id') userId: string,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ): Promise<NotificationView> {
    return this.notifications.markRead(userId, notificationId);
  }
}
