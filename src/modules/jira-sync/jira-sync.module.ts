import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JiraSyncController } from './jira-sync.controller';
import { JiraSyncService } from './jira-sync.service';
import { JiraIssueMapping } from './entities/jira-issue-mapping.entity';
import { SyncLog } from './entities/sync-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([JiraIssueMapping, SyncLog])],
  controllers: [JiraSyncController],
  providers: [JiraSyncService],
  exports: [JiraSyncService],
})
export class JiraSyncModule {}
