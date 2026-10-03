import { readFileSync } from 'fs';
import { join } from 'path';
import { DOMAIN_EVENT_TYPES } from './domain-events';

/** The names in docs/api/ws-events.md are a contract with the frontend; the code must match. */
describe('WebSocket contract document', () => {
  const doc = readFileSync(
    join(__dirname, '..', '..', '..', 'docs', 'api', 'ws-events.md'),
    'utf8',
  );
  const section = doc.slice(doc.indexOf('### Event types'));
  const documented = [...section.matchAll(/^\| `([a-z]+\.[a-z]+)` \|/gm)].map((match) => match[1]);

  it('documents exactly the event types the code defines', () => {
    expect([...documented].sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
  });

  it('documents the namespace, the rooms and the join/leave messages', () => {
    expect(doc).toContain('/realtime');
    expect(doc).toContain('board:{boardId}');
    expect(doc).toContain('`board:join`');
    expect(doc).toContain('`board:leave`');
  });

  it('documents the origin values', () => {
    expect(doc).toMatch(/`user`/);
    expect(doc).toMatch(/`jira`/);
  });
});
