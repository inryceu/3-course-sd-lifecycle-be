import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth';
import { ATLASSIAN_OAUTH } from './application/atlassian-oauth.port';
import { JiraConnectionService } from './application/jira-connection.service';
import { JiraOAuthService } from './application/jira-oauth.service';
import { BoardEventsListener } from './application/board-events.listener';
import { TOKEN_CIPHER } from './application/token-cipher.port';
import { AesGcmTokenCipher } from './infrastructure/aes-gcm-token-cipher';
import { AtlassianOAuthHttpClient } from './infrastructure/atlassian-oauth.http-client';
import { JiraConnectionEntity } from './infrastructure/persistence/jira-connection.entity';
import { JiraIssueMappingEntity } from './infrastructure/persistence/jira-issue-mapping.entity';
import { JiraOAuthStateEntity } from './infrastructure/persistence/jira-oauth-state.entity';
import { SyncLogEntity } from './infrastructure/persistence/sync-log.entity';
import { JiraOAuthController } from './presentation/jira-oauth.controller';

@Module({
  imports: [
    // jira-sync -> auth (identity). jira-sync -> boards goes through the global BOARDS_FACADE port.
    AuthModule,
    TypeOrmModule.forFeature([
      JiraConnectionEntity,
      JiraOAuthStateEntity,
      JiraIssueMappingEntity,
      SyncLogEntity,
    ]),
  ],
  controllers: [JiraOAuthController],
  providers: [
    JiraOAuthService,
    JiraConnectionService,
    BoardEventsListener,
    AesGcmTokenCipher,
    AtlassianOAuthHttpClient,
    { provide: TOKEN_CIPHER, useExisting: AesGcmTokenCipher },
    { provide: ATLASSIAN_OAUTH, useExisting: AtlassianOAuthHttpClient },
  ],
})
export class JiraSyncModule {}
