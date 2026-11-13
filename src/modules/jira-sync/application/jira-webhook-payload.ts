import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { JiraStatus } from './jira-gateway.port';

export type ParsedJiraWebhook =
  | { readonly kind: 'ignored'; readonly event: string; readonly timestamp: string | null }
  | {
      readonly kind: 'status';
      readonly event: string;
      readonly timestamp: string | null;
      readonly issueId: string;
      readonly issueKey: string;
      /** `issue.self`, the REST URL on the Jira site that sent the delivery. */
      readonly issueSelf: string | null;
      readonly changelogId: string | null;
      readonly status: JiraStatus;
    };

export function parseJiraWebhookPayload(body: unknown): ParsedJiraWebhook {
  if (!isRecord(body) || typeof body['webhookEvent'] !== 'string') {
    throw new BadRequestException('Malformed Jira webhook payload');
  }

  const event = body['webhookEvent'];
  const timestamp = Number.isSafeInteger(body['timestamp']) ? String(body['timestamp']) : null;
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
    issueSelf: typeof issue['self'] === 'string' ? issue['self'] : null,
    changelogId:
      typeof changelogId === 'string' || typeof changelogId === 'number'
        ? String(changelogId)
        : null,
    status: {
      id: status['id'],
      name: typeof status['name'] === 'string' ? status['name'] : status['id'],
      statusCategory: {
        id: isRecord(category) && typeof category['id'] === 'number' ? category['id'] : 0,
        key: isRecord(category) && typeof category['key'] === 'string' ? category['key'] : '',
        name: isRecord(category) && typeof category['name'] === 'string' ? category['name'] : '',
      },
    },
  };
}

/**
 * Dedup key from signed content only. `X-Atlassian-Webhook-Identifier` is not covered by the
 * signature, so a replay could pick a fresh one; event + issue id + changelog id is stable across
 * Jira retries and part of the signed body.
 */
export function buildDeliveryKey(payload: ParsedJiraWebhook, rawBody: Buffer): string {
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
