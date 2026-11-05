import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth';
import { ATLASSIAN_OAUTH } from './application/atlassian-oauth.port';
import { JIRA_GATEWAY } from './application/jira-gateway.port';
import { JiraConnectionService } from './application/jira-connection.service';
import { JiraImportService } from './application/jira-import.service';
import { JiraStatusMappingService } from './application/jira-status-mapping.service';
import { JiraOAuthService } from './application/jira-oauth.service';
import { JiraWebhookAuthenticityService } from './application/jira-webhook-authenticity.service';
import { JiraWebhookDeliveryService } from './application/jira-webhook-delivery.service';
import { JiraWebhookLifecycleService } from './application/jira-webhook-lifecycle.service';
import { JiraWebhookService } from './application/jira-webhook.service';
import { TOKEN_CIPHER } from './application/token-cipher.port';
import { AesGcmTokenCipher } from './infrastructure/aes-gcm-token-cipher';
import { AtlassianOAuthHttpClient } from './infrastructure/atlassian-oauth.http-client';
import {
  JIRA_GATEWAY_OPTIONS,
  JiraGatewayHttpClient,
} from './infrastructure/jira-gateway.http-client';
import { JiraConnectionEntity } from './infrastructure/persistence/jira-connection.entity';
import { JiraIssueMappingEntity } from './infrastructure/persistence/jira-issue-mapping.entity';
import { JiraOAuthStateEntity } from './infrastructure/persistence/jira-oauth-state.entity';
import { JiraStatusMappingEntity } from './infrastructure/persistence/jira-status-mapping.entity';
import { JiraWebhookDeliveryEntity } from './infrastructure/persistence/jira-webhook-delivery.entity';
import { JiraWebhookEntity } from './infrastructure/persistence/jira-webhook.entity';
import { SyncLogEntity } from './infrastructure/persistence/sync-log.entity';
import { JiraImportController } from './presentation/jira-import.controller';
import { JiraOAuthController } from './presentation/jira-oauth.controller';
import { JiraWebhookController } from './presentation/jira-webhook.controller';
import { BoardsModule } from '../boards';

@Module({
  imports: [
    // jira-sync -> auth (identity) and -> boards (only through the exported BOARDS_FACADE port).
    AuthModule,
    BoardsModule,
    TypeOrmModule.forFeature([
      JiraConnectionEntity,
      JiraOAuthStateEntity,
      JiraIssueMappingEntity,
      JiraStatusMappingEntity,
      JiraWebhookDeliveryEntity,
      JiraWebhookEntity,
      SyncLogEntity,
    ]),
  ],
  controllers: [JiraOAuthController, JiraImportController, JiraWebhookController],
  providers: [
    JiraOAuthService,
    JiraConnectionService,
    JiraImportService,
    JiraStatusMappingService,
    JiraWebhookAuthenticityService,
    JiraWebhookDeliveryService,
    JiraWebhookLifecycleService,
    JiraWebhookService,
    AesGcmTokenCipher,
    AtlassianOAuthHttpClient,
    JiraGatewayHttpClient,
    { provide: TOKEN_CIPHER, useExisting: AesGcmTokenCipher },
    { provide: ATLASSIAN_OAUTH, useExisting: AtlassianOAuthHttpClient },
    { provide: JIRA_GATEWAY_OPTIONS, useValue: {} },
    { provide: JIRA_GATEWAY, useExisting: JiraGatewayHttpClient },
  ],
})
export class JiraSyncModule {}
