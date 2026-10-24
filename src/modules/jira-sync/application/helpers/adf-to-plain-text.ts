interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

/** Block nodes whose text is separated by a line break. */
const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'rule']);

/**
 * Plain text of an Atlassian Document Format value (Jira issue description): text nodes are
 * concatenated, block nodes become lines, everything else (mentions, media, marks) is dropped.
 * Returns null for a missing or empty document.
 */
export function adfToPlainText(doc: unknown): string | null {
  if (typeof doc !== 'object' || doc === null) {
    return null;
  }
  const lines: string[] = [];
  let current = '';
  const walk = (node: AdfNode): void => {
    if (node.type === 'text' && typeof node.text === 'string') {
      current += node.text;
    } else if (node.type === 'hardBreak') {
      current += '\n';
    }
    node.content?.forEach(walk);
    // Nested blocks (a paragraph inside a list item) must not add an empty line.
    if (node.type && BLOCKS.has(node.type) && current !== '') {
      lines.push(current);
      current = '';
    }
  };
  walk(doc as AdfNode);
  if (current) lines.push(current);
  const text = lines.join('\n').trim();
  return text.length > 0 ? text : null;
}
