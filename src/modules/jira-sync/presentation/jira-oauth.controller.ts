import { Controller, Delete, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth';
import {
  JiraConnectionService,
  JiraConnectionStatus,
} from '../application/jira-connection.service';
import {
  JiraOAuthService,
  OAuthCallbackResult,
  OAuthStartResult,
} from '../application/jira-oauth.service';
import { BoardQueryDto, OAuthCallbackQueryDto } from './dto/jira.dto';

@ApiTags('jira')
@ApiBearerAuth()
@Controller('jira')
export class JiraOAuthController {
  constructor(
    private readonly oauth: JiraOAuthService,
    private readonly connection: JiraConnectionService,
  ) {}

  @Get('oauth/start')
  @ApiOperation({ summary: 'Start the OAuth 2.0 (3LO) flow for a board (Admin)' })
  start(
    @CurrentUser('id') userId: string,
    @Query() query: BoardQueryDto,
  ): Promise<OAuthStartResult> {
    return this.oauth.start(userId, query.boardId);
  }

  @Get('oauth/callback')
  @ApiOperation({ summary: 'Complete the flow with the code and state from the redirect' })
  callback(
    @CurrentUser('id') userId: string,
    @Query() query: OAuthCallbackQueryDto,
  ): Promise<OAuthCallbackResult> {
    return this.oauth.callback(userId, query);
  }

  @Get('connection')
  @ApiOperation({ summary: 'Connection status of a board (any member)' })
  status(
    @CurrentUser('id') userId: string,
    @Query() query: BoardQueryDto,
  ): Promise<JiraConnectionStatus> {
    return this.connection.getStatus(userId, query.boardId);
  }

  @Delete('connection')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect and delete stored credentials (Admin)' })
  disconnect(@CurrentUser('id') userId: string, @Query() query: BoardQueryDto): Promise<void> {
    return this.connection.disconnect(userId, query.boardId);
  }
}
