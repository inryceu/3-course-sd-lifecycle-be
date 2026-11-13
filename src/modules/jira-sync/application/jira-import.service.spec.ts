import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { BoardRole, BoardsFacade, BoardSummary, ColumnType } from '../../boards';
import {
  JiraClientError,
  JiraRateLimitedError,
  JiraServerError,
  JiraUnauthorizedError,
} from '../domain/jira-gateway.errors';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraIssueMappingEntity } from '../infrastructure/persistence/jira-issue-mapping.entity';
import { JiraStatusMappingEntity } from '../infrastructure/persistence/jira-status-mapping.entity';
import { JiraGateway, JiraIssue, JiraStatus } from './jira-gateway.port';
import { JiraImportService } from './jira-import.service';
import { JiraStatusMappingService } from './jira-status-mapping.service';

const status = (id: string, name: string, key: string): JiraStatus => ({
  id,
  name,
  statusCategory: { id: 1, key, name: key },
});
const TODO = status('1', 'To Do', 'new');
const DOING = status('3', 'In Progress', 'indeterminate');
const REVIEW = status('5', 'In Review', 'indeterminate');
const DONE = status('9', 'Done', 'done');

const board = (jiraProjectKey: string | null = null): BoardSummary => ({
  id: 'b1',
  jiraProjectKey,
  columns: [
    { id: 'col-todo', title: 'To Do', type: ColumnType.TODO, position: 0 },
    { id: 'col-doing', title: 'In Progress', type: ColumnType.IN_PROGRESS, position: 1 },
    { id: 'col-done', title: 'Done', type: ColumnType.DONE, position: 2 },
  ],
});

const issue = (key: string, st: JiraStatus, summary = key): JiraIssue => ({
  id: key.replace(/\D/g, ''),
  key,
  self: `https://x/${key}`,
  fields: {
    summary,
    status: st,
    assignee: null,
    reporter: null,
    created: '',
    updated: '',
    // `description` is requested as an extra field and arrives as ADF.
    ...({
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `About ${key}` }] }],
      },
    } as object),
  },
});

function setup(
  options: {
    role?: BoardRole | null;
    summary?: BoardSummary | null;
    connected?: boolean;
    stored?: Partial<JiraStatusMappingEntity>[];
  } = {},
) {
  const facade: jest.Mocked<BoardsFacade> = {
    getMemberRole: jest
      .fn()
      .mockResolvedValue(options.role === undefined ? BoardRole.ADMIN : options.role),
    getBoardSummary: jest
      .fn()
      .mockResolvedValue(options.summary === undefined ? board() : options.summary),
    setJiraProjectKey: jest.fn().mockResolvedValue(undefined),
    upsertCardFromExternal: jest
      .fn()
      .mockImplementation(({ jiraIssueKey }: { jiraIssueKey: string }) =>
        Promise.resolve({ cardId: `card-${jiraIssueKey}`, outcome: 'created' }),
      ),
    moveCardFromExternal: jest.fn(),
  };
  const gateway = {
    listProjects: jest.fn().mockResolvedValue([
      { id: '2', key: 'OPS', name: 'Ops' },
      { id: '1', key: 'KAN', name: 'Kanban' },
    ]),
    listProjectStatuses: jest.fn().mockResolvedValue([TODO, DOING, REVIEW, DONE]),
    searchIssues: jest.fn().mockResolvedValue({ issues: [], nextPageToken: null, isLast: true }),
  } as unknown as jest.Mocked<JiraGateway>;
  const statusRepo = {
    find: jest.fn().mockResolvedValue(options.stored ?? []),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const connections = { exist: jest.fn().mockResolvedValue(options.connected ?? true) };
  const links = {
    upsert: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
  };
  const mappings = new JiraStatusMappingService(
    statusRepo as unknown as Repository<JiraStatusMappingEntity>,
    connections as unknown as Repository<JiraConnectionEntity>,
    facade,
    gateway,
  );
  const importer = new JiraImportService(
    links as unknown as Repository<JiraIssueMappingEntity>,
    facade,
    gateway,
    mappings,
  );
  return { facade, gateway, statusRepo, links, mappings, importer };
}

describe('JiraStatusMappingService', () => {
  it('defaults by status category and marks the defaults', async () => {
    const { mappings } = setup({ summary: board('KAN') });

    const result = await mappings.list('u', 'b1');

    expect(result.map((m) => [m.jiraStatusName, m.columnId, m.isDefault])).toEqual([
      ['To Do', 'col-todo', true],
      ['In Progress', 'col-doing', true],
      ['In Review', 'col-doing', true],
      ['Done', 'col-done', true],
    ]);
  });

  it('prefers a stored column, and falls back to the default when that column was deleted', async () => {
    const { mappings } = setup({
      summary: board('KAN'),
      stored: [
        { jiraStatusId: '5', columnId: 'col-done' },
        { jiraStatusId: '1', columnId: 'deleted-column' },
      ],
    });

    const result = await mappings.list('u', 'b1');

    expect(result.find((m) => m.jiraStatusId === '5')).toMatchObject({
      columnId: 'col-done',
      isDefault: false,
    });
    expect(result.find((m) => m.jiraStatusId === '1')).toMatchObject({
      columnId: 'col-todo',
      isDefault: true,
    });
  });

  it('uses the first column when the board has no column of the category type', async () => {
    const summary = board('KAN');
    summary.columns = summary.columns.filter((c) => c.type !== ColumnType.DONE);
    const { mappings } = setup({ summary });

    const result = await mappings.list('u', 'b1');

    expect(result.find((m) => m.jiraStatusId === '9')?.columnId).toBe('col-todo');
  });

  it('saves a valid mapping and rejects columns or statuses that do not belong', async () => {
    const { mappings, statusRepo } = setup({ summary: board('KAN') });

    await mappings.save('u', 'b1', [{ jiraStatusId: '5', columnId: 'col-done' }]);
    expect(statusRepo.upsert).toHaveBeenCalledWith(
      [{ boardId: 'b1', jiraStatusId: '5', jiraStatusName: 'In Review', columnId: 'col-done' }],
      ['boardId', 'jiraStatusId'],
    );

    await expect(
      mappings.save('u', 'b1', [{ jiraStatusId: '5', columnId: 'other-board-column' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      mappings.save('u', 'b1', [{ jiraStatusId: '404', columnId: 'col-done' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets only the Admin save, hides the board from strangers, and needs a connection and a project', async () => {
    await expect(
      setup({ role: BoardRole.MEMBER }).mappings.save('u', 'b1', []),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup({ role: null }).mappings.list('u', 'b1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(setup({ connected: false }).mappings.list('u', 'b1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(setup({ summary: board(null) }).mappings.list('u', 'b1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('JiraImportService', () => {
  it('links the project, imports every page through the facade and counts the outcomes', async () => {
    const { importer, facade, gateway, links } = setup();
    gateway.searchIssues
      .mockResolvedValueOnce({
        issues: [issue('KAN-1', TODO), issue('KAN-2', DOING)],
        nextPageToken: 'p2',
        isLast: false,
      })
      .mockResolvedValueOnce({
        issues: [issue('KAN-3', REVIEW)],
        nextPageToken: null,
        isLast: true,
      });
    facade.upsertCardFromExternal
      .mockResolvedValueOnce({ cardId: 'c1', outcome: 'created' })
      .mockResolvedValueOnce({ cardId: 'c2', outcome: 'updated' })
      .mockResolvedValueOnce({ cardId: 'c3', outcome: 'unchanged' });

    const result = await importer.import('u', 'b1', 'KAN');

    expect(result).toEqual({ imported: 2, created: 1, updated: 1, skipped: 1 });
    expect(facade.setJiraProjectKey).toHaveBeenCalledWith('b1', 'KAN');
    expect(gateway.searchIssues).toHaveBeenCalledTimes(2);
    expect(gateway.searchIssues.mock.calls[0][0]).toMatchObject({
      jql: 'project = "KAN" AND statusCategory != Done ORDER BY key',
      fields: ['description'],
    });
    expect(gateway.searchIssues.mock.calls[1][0].nextPageToken).toBe('p2');
    expect(facade.upsertCardFromExternal).toHaveBeenNthCalledWith(1, {
      boardId: 'b1',
      columnId: 'col-todo',
      jiraIssueKey: 'KAN-1',
      title: 'KAN-1',
      description: 'About KAN-1',
    });
    expect(facade.upsertCardFromExternal.mock.calls[1][0].columnId).toBe('col-doing');
    expect(links.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 'b1',
        cardId: 'c1',
        jiraIssueKey: 'KAN-1',
        jiraIssueId: '1',
        jiraProjectKey: 'KAN',
      }),
      ['boardId', 'jiraIssueKey'],
    );
  });

  it('uses the stored project key when none is given and does not rewrite it', async () => {
    const { importer, facade, gateway } = setup({ summary: board('KAN') });

    await importer.import('u', 'b1');

    expect(facade.setJiraProjectKey).not.toHaveBeenCalled();
    expect(gateway.listProjectStatuses).toHaveBeenCalledWith({ boardId: 'b1', projectKey: 'KAN' });
  });

  it('does not store the key when the project does not exist', async () => {
    const { importer, facade, gateway } = setup();
    gateway.listProjectStatuses.mockRejectedValue(new JiraClientError(404, 'not found'));

    await expect(importer.import('u', 'b1', 'NOPE')).rejects.toBeInstanceOf(BadRequestException);
    expect(facade.setJiraProjectKey).not.toHaveBeenCalled();
  });

  it.each([
    [new JiraUnauthorizedError('reconnect required'), 409],
    [new JiraClientError(403, 'missing_scope'), 403],
    [new JiraRateLimitedError(30), 429],
    [new JiraServerError(503, 3, 3), 502],
  ])('maps %s to HTTP %i', async (error, httpStatus) => {
    const { importer, gateway } = setup({ summary: board('KAN') });
    gateway.searchIssues.mockRejectedValue(error);

    const failure = await importer.import('u', 'b1').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(httpStatus);
  });

  it('requires the Admin role', async () => {
    await expect(
      setup({ role: BoardRole.VIEWER }).importer.import('u', 'b1', 'KAN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a malformed key before calling Jira', async () => {
    const { importer, gateway } = setup();
    await expect(importer.import('u', 'b1', 'kan-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(gateway.listProjectStatuses).not.toHaveBeenCalled();
  });
});

describe('JiraImportService.listProjects', () => {
  it('returns the projects of the connection sorted by name to any member', async () => {
    const { importer, gateway } = setup({ role: BoardRole.VIEWER });

    await expect(importer.listProjects('u', 'b1')).resolves.toEqual([
      { id: '1', key: 'KAN', name: 'Kanban' },
      { id: '2', key: 'OPS', name: 'Ops' },
    ]);
    expect(gateway.listProjects).toHaveBeenCalledWith({ boardId: 'b1' });
  });

  it('answers 404 to a non-member and 409 for a board without a connection', async () => {
    await expect(setup({ role: null }).importer.listProjects('u', 'b1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const { importer, gateway } = setup({ connected: false });
    await expect(importer.listProjects('u', 'b1')).rejects.toBeInstanceOf(ConflictException);
    expect(gateway.listProjects).not.toHaveBeenCalled();
  });

  it('maps gateway failures like the import', async () => {
    const { importer, gateway } = setup();
    gateway.listProjects.mockRejectedValue(new JiraUnauthorizedError('reconnect required'));

    await expect(importer.listProjects('u', 'b1')).rejects.toBeInstanceOf(ConflictException);
  });
});
