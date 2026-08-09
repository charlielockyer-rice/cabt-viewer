import { describe, expect, it } from 'vitest';
import { clipMarkdownPreview, formatClipMarkdown, formatClipMarkdownLine } from './clipMarkdown';

describe('formatClipMarkdownLine', () => {
  it('marks bold and code runs and leaves the rest plain', () => {
    expect(formatClipMarkdownLine('Play **Ultra Ball** then `end turn`.')).toEqual([
      { text: 'Play ', style: 'plain' },
      { text: 'Ultra Ball', style: 'bold' },
      { text: ' then ', style: 'plain' },
      { text: 'end turn', style: 'code' },
      { text: '.', style: 'plain' },
    ]);
  });

  it('keeps unclosed markers literal', () => {
    expect(formatClipMarkdownLine('2 ** 3 and a `stray tick')).toEqual([
      { text: '2 ** 3 and a `stray tick', style: 'plain' },
    ]);
  });
});

describe('formatClipMarkdown', () => {
  it('splits paragraphs on blank lines and keeps single newlines as breaks', () => {
    expect(formatClipMarkdown('one\ntwo\n\n\nthree')).toEqual([
      { lines: [[{ text: 'one', style: 'plain' }], [{ text: 'two', style: 'plain' }]] },
      { lines: [[{ text: 'three', style: 'plain' }]] },
    ]);
  });

  it('normalizes CRLF and returns nothing for empty commentary', () => {
    expect(formatClipMarkdown('a\r\n\r\nb').length).toBe(2);
    expect(formatClipMarkdown('')).toEqual([]);
    expect(formatClipMarkdown(undefined)).toEqual([]);
    expect(formatClipMarkdown('   \n  ')).toEqual([]);
  });
});

describe('clipMarkdownPreview', () => {
  it('takes the first line with its markers stripped', () => {
    expect(clipMarkdownPreview('The **fork**.\nSecond line.\n\nSecond paragraph.'))
      .toBe('The fork.');
  });

  it('truncates long previews', () => {
    expect(clipMarkdownPreview('abcdefghij', 5)).toBe('abcd…');
    expect(clipMarkdownPreview(undefined)).toBe('');
  });
});
