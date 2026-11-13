import { Repository } from 'typeorm';
import { BoardsFacade, BoardSummary, ColumnType } from '../../boards';
import { JiraConnectionEntity } from '../infrastructure/persistence/jira-connection.entity';
import { JiraStatusMappingEntity } from '../infrastructure/persistence/jira-status-mapping.entity';
import { JiraGateway, JiraStatus } from './jira-gateway.port';
import { JiraStatusMappingService, LinkedBoard } from './jira-status-mapping.service';

const status = (id: string, name: string, key: string): JiraStatus => ({
  id,
  name,
  statusCategory: { id: 1, key, name: key },
});
const TODO = status('1', 'To Do', 'new');
const REVIEW = status('5', 'In Review', 'indeterminate');
const DONE = status('9', 'Done', 'done');

const board: BoardSummary = {
  id: 'b1',
  jiraProjectKey: 'KAN',
  columns: [
    { id: 'col-todo', title: 'To Do', type: ColumnType.TODO, position: 0 },
    { id: 'col-doing', title: 'In Progress', type: ColumnType.IN_PROGRESS, position: 1 },
    { id: 'col-done', title: 'Done', type: ColumnType.DONE, position: 2 },
  ],
};

const linked: LinkedBoard = { board, projectKey: 'KAN' };

function setup(stored: Partial<JiraStatusMappingEntity>[] = []) {
  const statusRepo = {
    find: jest.fn().mockResolvedValue(stored),
  };
  const connections = { exist: jest.fn().mockResolvedValue(true) };
  const facade = {} as jest.Mocked<BoardsFacade>;
  const gateway = {} as jest.Mocked<JiraGateway>;
  const service = new JiraStatusMappingService(
    statusRepo as unknown as Repository<JiraStatusMappingEntity>,
    connections as unknown as Repository<JiraConnectionEntity>,
    facade,
    gateway,
  );
  return { service, statusRepo };
}

describe('JiraStatusMappingService.resolveMappings', () => {
  it('marks explicit rows and category defaults separately', async () => {
    const { service } = setup([
      { jiraStatusId: DONE.id, columnId: 'col-done' },
      { jiraStatusId: TODO.id, columnId: 'deleted-column' },
    ]);

    const result = await service.resolveMappings(linked, [TODO, REVIEW, DONE]);

    expect(result).toEqual([
      {
        jiraStatusId: TODO.id,
        jiraStatusName: TODO.name,
        statusCategory: 'new',
        columnId: 'col-todo',
        isDefault: true,
      },
      {
        jiraStatusId: REVIEW.id,
        jiraStatusName: REVIEW.name,
        statusCategory: 'indeterminate',
        columnId: 'col-doing',
        isDefault: true,
      },
      {
        jiraStatusId: DONE.id,
        jiraStatusName: DONE.name,
        statusCategory: 'done',
        columnId: 'col-done',
        isDefault: false,
      },
    ]);
  });

  it('keeps columnsByStatus as a column-id map', async () => {
    const { service } = setup([{ jiraStatusId: DONE.id, columnId: 'col-done' }]);

    await expect(service.columnsByStatus(linked, [TODO, REVIEW, DONE])).resolves.toEqual(
      new Map([
        [TODO.id, 'col-todo'],
        [REVIEW.id, 'col-doing'],
        [DONE.id, 'col-done'],
      ]),
    );
  });
});
