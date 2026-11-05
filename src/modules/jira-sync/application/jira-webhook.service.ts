import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IncomingHttpHeaders } from 'http';
import { Repository } from 'typeorm';
import { BOARDS_FACADE, BoardsFacade } from '../../boards';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { JiraWebhookAuthenticityService } from './jira-webhook-authenticity.service';
import { JiraWebhookDeliveryService } from './jira-webhook-delivery.service';
import {
  buildDeliveryKey,
  parseJiraWebhookPayload,
  ParsedJiraWebhook,
} from './jira-webhook-payload';
import { JiraStatusMappingService } from './jira-status-mapping.service';

@Injectable()
export class JiraWebhookService {
  private readonly logger = new Logger(JiraWebhookService.name);

  constructor(
    private readonly authenticity: JiraWebhookAuthenticityService,
    private readonly deliveries: JiraWebhookDeliveryService,
    private readonly statusMappings: JiraStatusMappingService,
    @InjectRepository(JiraIssueMappingEntity)
    private readonly links: Repository<JiraIssueMappingEntity>,
    @Inject(BOARDS_FACADE) private readonly boards: BoardsFacade,
  ) {}

  async receive(rawBody: Buffer, body: unknown, headers: IncomingHttpHeaders): Promise<void> {
    this.authenticity.verify(rawBody, headers);
    const payload = parseJiraWebhookPayload(body);
    const deliveryKey = buildDeliveryKey(
      headerValue(headers['x-atlassian-webhook-identifier']),
      payload,
      rawBody,
    );
    const keyPrefix = deliveryKey.slice(0, 8);
    const startedAt = Date.now();
    const timestamp = payload.timestamp ?? '-';

    if (!(await this.deliveries.claim(deliveryKey))) {
      this.logger.log(
        `event=${payload.event} delivery=${keyPrefix} timestamp=${timestamp} outcome=duplicate`,
      );
      return;
    }

    let completed = false;
    try {
      const outcome = await this.apply(payload);
      await this.deliveries.complete(deliveryKey);
      completed = true;
      this.logger.log(
        `event=${payload.event} delivery=${keyPrefix} timestamp=${timestamp} outcome=${outcome} latencyMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      this.logger.error(
        `event=${payload.event} delivery=${keyPrefix} timestamp=${timestamp} outcome=failed error=${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      throw error;
    } finally {
      if (!completed) {
        try {
          await this.deliveries.release(deliveryKey);
        } catch (error) {
          this.logger.error(
            `delivery=${keyPrefix} outcome=release-failed error=${
              error instanceof Error ? error.message : 'unknown'
            }`,
          );
        }
      }
    }
  }

  private async apply(payload: ParsedJiraWebhook): Promise<string> {
    if (payload.kind === 'ignored') return 'ignored';

    const link = await this.links.findOne({ where: { jiraIssueKey: payload.issueKey } });
    if (!link || !link.cardId) return 'unknown-issue';

    const columnId = await this.statusMappings.columnForStatus(link.boardId, payload.status);
    if (!columnId) return 'unknown-board';

    return this.boards.moveCardFromExternal({
      boardId: link.boardId,
      jiraIssueKey: payload.issueKey,
      columnId,
    });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
