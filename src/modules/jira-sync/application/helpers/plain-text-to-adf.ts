import { JiraCommentBody } from '../jira-gateway.port';

/** Wraps plain text in a minimal one-paragraph Atlassian Document Format document. */
export function plainTextToAdf(text: string): JiraCommentBody {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}
