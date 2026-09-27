import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JiraIssueMapping } from './entities/jira-issue-mapping.entity';
import { SyncLog, SyncDirection, SyncStatus } from './entities/sync-log.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JiraSyncService {
  private readonly logger = new Logger(JiraSyncService.name);

  constructor(
    @InjectRepository(JiraIssueMapping)
    private mappingsRepository: Repository<JiraIssueMapping>,
    @InjectRepository(SyncLog)
    private syncLogsRepository: Repository<SyncLog>,
    private configService: ConfigService,
  ) {}

  async createMapping(boardId: string, cardId: string, jiraIssueKey: string, jiraIssueId: string, jiraProjectKey: string, userId: string): Promise<JiraIssueMapping> {
    const mapping = this.mappingsRepository.create({
      board: { id: boardId } as any,
      card: { id: cardId } as any,
      jiraIssueKey,
      jiraIssueId,
      jiraProjectKey,
      createdBy: { id: userId } as any,
    });
    return this.mappingsRepository.save(mapping);
  }

  async findByCard(cardId: string): Promise<JiraIssueMapping | null> {
    return this.mappingsRepository.findOne({ where: { card: { id: cardId } } });
  }

  async findByBoard(boardId: string): Promise<JiraIssueMapping[]> {
    return this.mappingsRepository.find({ where: { board: { id: boardId } } });
  }

  syncCardToJira(cardId: string): void {
    // TODO: Implement Jira API call to update issue
    this.logger.log(`Syncing card ${cardId} to Jira`);
    // await this.logSync(mappingId, SyncDirection.TO_JIRA, SyncStatus.SUCCESS, payload);
  }

  syncCardFromJira(jiraIssueKey: string): void {
    // TODO: Implement Jira webhook handler
    this.logger.log(`Syncing from Jira: ${jiraIssueKey}`);
  }

  private async logSync(mappingId: string, direction: SyncDirection, status: SyncStatus, payload?: unknown, errorMessage?: string): Promise<void> {
    const log = this.syncLogsRepository.create({
      mapping: { id: mappingId } as any,
      direction,
      status,
      payload,
      errorMessage,
    });
    await this.syncLogsRepository.save(log);
  }
}