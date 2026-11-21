import { JiraCommentBody } from '../jira-gateway.port';

/**
 * Wraps plain text in a minimal Atlassian Document Format document, one paragraph per line
 * (ADF ignores a newline inside a text node; an empty line becomes an empty paragraph).
 */
export function plainTextToAdf(text: string): JiraCommentBody {
  return {
    type: 'doc',
    version: 1,
    content: text.split(/\r\n|\r|\n/).map((line) => ({
      type: 'paragraph',
      content: line === '' ? [] : [{ type: 'text', text: line }],
    })),
  };
}
