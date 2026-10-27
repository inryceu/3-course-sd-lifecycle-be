import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth';
import { JiraProject } from '../application/jira-gateway.port';
import { ImportResult, IssueLinkView, JiraImportService } from '../application/jira-import.service';
import {
  JiraStatusMappingService,
  StatusMappingView,
} from '../application/jira-status-mapping.service';
import { BoardQueryDto, JiraImportDto, PutStatusMappingsDto } from './dto/jira.dto';

@ApiTags('jira')
@ApiBearerAuth()
@Controller('jira')
export class JiraImportController {
  constructor(
    private readonly importer: JiraImportService,
    private readonly statusMappings: JiraStatusMappingService,
  ) {}

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link the board to a Jira project and import its open issues as cards (Admin)',
  })
  import(@CurrentUser('id') userId: string, @Body() dto: JiraImportDto): Promise<ImportResult> {
    return this.importer.import(userId, dto.boardId, dto.projectKey);
  }

  @Get('projects')
  @ApiOperation({ summary: "Jira projects visible to the board's connection (any member)" })
  listProjects(
    @CurrentUser('id') userId: string,
    @Query() query: BoardQueryDto,
  ): Promise<JiraProject[]> {
    return this.importer.listProjects(userId, query.boardId);
  }

  @Get('status-mappings')
  @ApiOperation({ summary: 'Jira status to column mapping, with defaults (any member)' })
  listStatusMappings(
    @CurrentUser('id') userId: string,
    @Query() query: BoardQueryDto,
  ): Promise<StatusMappingView[]> {
    return this.statusMappings.list(userId, query.boardId);
  }

  @Put('status-mappings')
  @ApiOperation({ summary: 'Store which column each Jira status maps to (Admin)' })
  putStatusMappings(
    @CurrentUser('id') userId: string,
    @Body() dto: PutStatusMappingsDto,
  ): Promise<StatusMappingView[]> {
    return this.statusMappings.save(userId, dto.boardId, dto.mappings);
  }

  @Get('mappings')
  @ApiOperation({ summary: 'Card to issue links of a board (any member)' })
  listLinks(
    @CurrentUser('id') userId: string,
    @Query() query: BoardQueryDto,
  ): Promise<IssueLinkView[]> {
    return this.importer.listLinks(userId, query.boardId);
  }
}
