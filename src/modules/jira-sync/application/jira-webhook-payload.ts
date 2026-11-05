import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';

export interface JiraWebhookStatusSnapshot {
  readonly id: string;
  readonly name: string;
  readonly categoryKey: string;
}

export type ParsedJiraWebhook =
  | { readonly kind: 'ignored'; readonly event: string; readonly timestamp: string | null }
  | {
      readonly kind: 'status';
      readonly event: string;
      readonly timestamp: string | null;
      readonly issueId: string;
      readonly issueKey: string;
      readonly changelogId: string | null;
      readonly status: JiraWebhookStatusSnapshot;
    };

export function parseJiraWebhookPayload(body: unknown): ParsedJiraWebhook {
  if (!isRecord(body) || typeof body['webhookEvent'] !== 'string') {
    throw new BadRequestException('Malformed Jira webhook payload');
  }

  const event = body['webhookEvent'];
  const timestamp = typeof body['timestamp'] === 'number' ? String(body['timestamp']) : null;
  if (event !== 'jira:issue_updated') {
    return { kind: 'ignored', event, timestamp };
  }

  const changelog = body['changelog'];
  if (!isRecord(changelog)) {
    return { kind: 'ignored', event, timestamp };
  }
  const items = changelog['items'];
  if (!Array.isArray(items)) {
    throw new BadRequestException('Malformed Jira webhook payload');
  }
  const statusChanged = items.some((item) => isRecord(item) && item['field'] === 'status');
  if (!statusChanged) {
    return { kind: 'ignored', event, timestamp };
  }

  const issue = body['issue'];
  if (!isRecord(issue)) {
    throw new BadRequestException('Malformed Jira webhook payload');
  }
  const issueId = issue['id'];
  const issueKey = issue['key'];
  const fields = issue['fields'];
  if (!isRecord(fields)) {
    throw new BadRequestException('Malformed Jira webhook payload');
  }
  const status = fields['status'];
  if (
    typeof issueId !== 'string' ||
    typeof issueKey !== 'string' ||
    !isRecord(status) ||
    typeof status['id'] !== 'string'
  ) {
    throw new BadRequestException('Malformed Jira webhook payload');
  }

  const category = status['statusCategory'];
  const changelogId = changelog['id'];
  return {
    kind: 'status',
    event,
    timestamp,
    issueId,
    issueKey,
    changelogId:
      typeof changelogId === 'string' || typeof changelogId === 'number'
        ? String(changelogId)
        : null,
    status: {
      id: status['id'],
      name: typeof status['name'] === 'string' ? status['name'] : status['id'],
      categoryKey: isRecord(category) && typeof category['key'] === 'string' ? category['key'] : '',
    },
  };
}

export function buildDeliveryKey(
  identifier: string | undefined,
  payload: ParsedJiraWebhook,
  rawBody: Buffer,
): string {
  if (identifier) return identifier;
  if (payload.kind === 'status' && payload.changelogId !== null) {
    return createHash('sha256')
      .update(`${payload.event}|${payload.issueId}|${payload.changelogId}`)
      .digest('hex');
  }
  return createHash('sha256').update(rawBody).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
