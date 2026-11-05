import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { buildDeliveryKey, parseJiraWebhookPayload } from './jira-webhook-payload';

const raw = Buffer.from('{}');

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    webhookEvent: 'jira:issue_updated',
    timestamp: 1_700_000_000_000,
    issue: {
      id: '10001',
      key: 'KAN-7',
      fields: {
        status: {
          id: '3',
          name: 'In Progress',
          statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' },
        },
      },
    },
    changelog: {
      id: '90001',
      items: [{ field: 'status', fieldId: 'status', fromString: 'To Do', toString: 'In Progress' }],
    },
    ...overrides,
  };
}

describe('parseJiraWebhookPayload', () => {
  it('extracts the status snapshot and identifiers from a status update', () => {
    const parsed = parseJiraWebhookPayload(payload());

    expect(parsed).toEqual({
      kind: 'status',
      event: 'jira:issue_updated',
      timestamp: '1700000000000',
      issueId: '10001',
      issueKey: 'KAN-7',
      changelogId: '90001',
      status: { id: '3', name: 'In Progress', categoryKey: 'indeterminate' },
    });
  });

  it('ignores updates whose changelog has no status item', () => {
    const parsed = parseJiraWebhookPayload(
      payload({ changelog: { id: '90002', items: [{ field: 'summary' }] } }),
    );
    expect(parsed).toMatchObject({ kind: 'ignored', event: 'jira:issue_updated' });
  });

  it('ignores unrelated events', () => {
    const parsed = parseJiraWebhookPayload(payload({ webhookEvent: 'jira:issue_created' }));
    expect(parsed).toMatchObject({ kind: 'ignored', event: 'jira:issue_created' });
  });

  it.each([
    ['null body', null],
    ['array body', []],
    ['missing event', { issue: {} }],
    ['status update with no issue', payload({ issue: undefined })],
    ['status update with no fields', payload({ issue: { id: '1', key: 'KAN-1' } })],
    [
      'status update with no status id',
      payload({ issue: { id: '1', key: 'KAN-1', fields: { status: {} } } }),
    ],
    ['items is not an array', payload({ changelog: { id: '1', items: 'status' } })],
  ])('rejects malformed input: %s', (_label, body) => {
    expect(() => parseJiraWebhookPayload(body)).toThrow(BadRequestException);
  });
});

describe('buildDeliveryKey', () => {
  const parsed = parseJiraWebhookPayload(payload());

  it('prefers the Atlassian delivery identifier', () => {
    expect(buildDeliveryKey('identifier-1', parsed, raw)).toBe('identifier-1');
  });

  it('hashes event, issue id and changelog id without timestamps', () => {
    const expected = createHash('sha256').update('jira:issue_updated|10001|90001').digest('hex');
    expect(buildDeliveryKey(undefined, parsed, raw)).toBe(expected);
  });

  it('falls back to the raw body when there is no changelog id', () => {
    const noChangelog = parseJiraWebhookPayload(
      payload({ changelog: { items: [{ field: 'status' }] } }),
    );
    expect(buildDeliveryKey(undefined, noChangelog, raw)).toBe(
      createHash('sha256').update(raw).digest('hex'),
    );
  });
});
