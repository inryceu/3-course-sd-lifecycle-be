import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JiraSyncService } from './jira-sync.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('jira-sync')
@Controller('jira-sync')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class JiraSyncController {
  constructor(private jiraSyncService: JiraSyncService) {}

  @Post('map')
  @ApiOperation({ summary: 'Create Jira issue mapping for a card' })
  @ApiResponse({ status: 201, description: 'Mapping created' })
  async createMapping(
    @CurrentUser('id') userId: string,
    @Body() body: { cardId: string; boardId: string; jiraIssueKey: string; jiraIssueId: string; jiraProjectKey: string },
  ) {
    return this.jiraSyncService.createMapping(
      body.boardId,
      body.cardId,
      body.jiraIssueKey,
      body.jiraIssueId,
      body.jiraProjectKey,
      userId,
    );
  }

  @Get('card/:cardId')
  @ApiOperation({ summary: 'Get Jira mapping for a card' })
  @ApiResponse({ status: 200, description: 'Mapping details' })
  async findByCard(@Param('cardId') cardId: string) {
    return this.jiraSyncService.findByCard(cardId);
  }

  @Get('board/:boardId')
  @ApiOperation({ summary: 'Get all Jira mappings for a board' })
  @ApiResponse({ status: 200, description: 'List of mappings' })
  async findByBoard(@Param('boardId') boardId: string) {
    return this.jiraSyncService.findByBoard(boardId);
  }

  @Post('sync/:cardId')
  @ApiOperation({ summary: 'Trigger sync for a card to Jira' })
  @ApiResponse({ status: 200, description: 'Sync triggered' })
  async syncToJira(@Param('cardId') cardId: string) {
    await this.jiraSyncService.syncCardToJira(cardId);
    return { message: 'Sync triggered' };
  }
}