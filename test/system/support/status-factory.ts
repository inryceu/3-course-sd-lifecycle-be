import { JiraStatus, JiraTransition } from '../../component/jira-sync/support/jira-stub';

export interface StatusFactory {
  TODO: JiraStatus;
  DOING: JiraStatus;
  DONE: JiraStatus;
  ALL_STATUSES: JiraStatus[];
  makeStatus(id: string, name: string, key: string): JiraStatus;
  makeTransition(to: JiraStatus): JiraTransition;
}

export function createStatusFactory(): StatusFactory {
  function makeStatus(id: string, name: string, key: string): JiraStatus {
    return {
      id,
      name,
      statusCategory: { id: key === 'done' ? 3 : key === 'indeterminate' ? 2 : 1, key, name: key },
    };
  }

  const TODO = makeStatus('1', 'To Do', 'new');
  const DOING = makeStatus('3', 'In Progress', 'indeterminate');
  const DONE = makeStatus('9', 'Done', 'done');
  const ALL_STATUSES = [TODO, DOING, DONE];

  function makeTransition(to: JiraStatus): JiraTransition {
    return {
      id: `${to.id}1`,
      name: `To ${to.name}`,
      to,
      hasScreen: false,
      isGlobal: true,
      isInitial: false,
      isConditional: false,
      isAvailable: true,
    };
  }

  return { TODO, DOING, DONE, ALL_STATUSES, makeStatus, makeTransition };
}
