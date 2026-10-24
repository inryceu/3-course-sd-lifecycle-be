import { adfToPlainText } from './adf-to-plain-text';

describe('adfToPlainText', () => {
  it('joins paragraphs and list items as lines and keeps hard breaks', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'First ' },
            { type: 'text', text: 'line' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('First line\nitem\na\nb');
  });

  it('returns null for a missing or empty description', () => {
    expect(adfToPlainText(null)).toBeNull();
    expect(adfToPlainText({ type: 'doc', version: 1, content: [] })).toBeNull();
  });
});
