import { CODE_EDITOR_DEFAULT_TEXT_COLOR } from './codeEditorStyles';

export type HtmlSyntaxPart = { text: string; color: string };

const HTML_COLORS = {
  tag: '#93C5FD',
  attribute: '#FCD34D',
  string: '#86EFAC',
  comment: '#6B7280',
  mergeTag: '#86EFAC',
  punctuation: '#6B7280',
  text: CODE_EDITOR_DEFAULT_TEXT_COLOR,
} as const;

/**
 * Display-only HTML tokenization for syntax highlighting.
 * Approximate — not a full HTML parser; invalid markup is fine.
 */
export function tokenizeHtmlSyntax(value: string): HtmlSyntaxPart[] {
  if (!value) {
    return [{ text: '<table>...</table>', color: HTML_COLORS.comment }];
  }

  const parts: HtmlSyntaxPart[] = [];
  let index = 0;

  while (index < value.length) {
    const rest = value.slice(index);

    const commentMatch = rest.match(/^<!--[\s\S]*?-->/);
    if (commentMatch) {
      parts.push({ text: commentMatch[0], color: HTML_COLORS.comment });
      index += commentMatch[0].length;
      continue;
    }

    const mergeTagMatch = rest.match(/^\{\{[^}]+\}\}/);
    if (mergeTagMatch) {
      parts.push({ text: mergeTagMatch[0], color: HTML_COLORS.mergeTag });
      index += mergeTagMatch[0].length;
      continue;
    }

    const stringMatch = rest.match(/^"(?:\\.|[^"\\])*"|^'(?:\\.|[^'\\])*'/);
    if (stringMatch) {
      parts.push({ text: stringMatch[0], color: HTML_COLORS.string });
      index += stringMatch[0].length;
      continue;
    }

    const tagMatch = rest.match(/^<\/?[\w-]+/);
    if (tagMatch) {
      parts.push({ text: tagMatch[0], color: HTML_COLORS.tag });
      index += tagMatch[0].length;
      continue;
    }

    const attrMatch = rest.match(/^[\w-]+(?==)/);
    if (attrMatch) {
      parts.push({ text: attrMatch[0], color: HTML_COLORS.attribute });
      index += attrMatch[0].length;
      continue;
    }

    const punctMatch = rest.match(/^[=>/]/);
    if (punctMatch) {
      parts.push({ text: punctMatch[0], color: HTML_COLORS.punctuation });
      index += punctMatch[0].length;
      continue;
    }

    parts.push({ text: rest[0], color: HTML_COLORS.text });
    index += 1;
  }

  return parts;
}
