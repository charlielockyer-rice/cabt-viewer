// Clip commentary is markdown, but a clip panel is not a document renderer.
// This is the whole supported subset: paragraphs (blank-line separated), hard
// line breaks, `**bold**`, and `code`. Everything else is shown verbatim.
//
// It emits spans rather than HTML on purpose: the panel renders them through
// normal Svelte markup, so author text can never inject markup.
export type ClipMarkdownSpan = {
  text: string;
  style: 'plain' | 'bold' | 'code';
};

export type ClipMarkdownParagraph = {
  lines: ClipMarkdownSpan[][];
};

export function formatClipMarkdown(markdown: string | undefined): ClipMarkdownParagraph[] {
  if (!markdown) {
    return [];
  }
  return markdown
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.trim().length > 0)
    .map((block) => ({ lines: block.split('\n').map(formatClipMarkdownLine) }));
}

// One line of markdown as styled spans. Unclosed markers stay literal, so a
// stray asterisk or backtick reads as the author typed it.
export function formatClipMarkdownLine(line: string): ClipMarkdownSpan[] {
  const spans: ClipMarkdownSpan[] = [];
  let plain = '';
  let index = 0;

  const flushPlain = () => {
    if (plain) {
      spans.push({ text: plain, style: 'plain' });
      plain = '';
    }
  };

  while (index < line.length) {
    const bold = line.startsWith('**', index) ? line.indexOf('**', index + 2) : -1;
    if (bold !== -1) {
      const text = line.slice(index + 2, bold);
      if (text) {
        flushPlain();
        spans.push({ text, style: 'bold' });
      }
      index = bold + 2;
      continue;
    }
    const code = line[index] === '`' ? line.indexOf('`', index + 1) : -1;
    if (code !== -1) {
      const text = line.slice(index + 1, code);
      if (text) {
        flushPlain();
        spans.push({ text, style: 'code' });
      }
      index = code + 1;
      continue;
    }
    plain += line[index];
    index += 1;
  }
  flushPlain();
  return spans;
}

// First line of the commentary, trimmed to a preview length. Used for the item
// list rows, where the full caption would crowd out the list.
export function clipMarkdownPreview(markdown: string | undefined, maxLength = 90): string {
  const [first] = formatClipMarkdown(markdown);
  if (!first) {
    return '';
  }
  const text = first.lines[0].map((span) => span.text).join('').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
