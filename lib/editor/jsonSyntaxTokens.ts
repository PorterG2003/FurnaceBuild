import { CODE_EDITOR_DEFAULT_TEXT_COLOR } from './codeEditorStyles';

export type JsonSyntaxPart = { text: string; color: string };

const jsonTokenRegex =
  /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}\[\]:,]/g;

export function getJsonTokenColor(token: string, isKey: boolean): string {
  if (token.startsWith('"')) {
    return isKey ? '#93C5FD' : '#86EFAC';
  }
  if (token === 'true' || token === 'false') {
    return '#F9A8D4';
  }
  if (token === 'null') {
    return '#C4B5FD';
  }
  if (/^-?\d/.test(token)) {
    return '#FCA5A5';
  }
  if (/^[{}\[\]:,]$/.test(token)) {
    return '#6B7280';
  }
  return CODE_EDITOR_DEFAULT_TEXT_COLOR;
}

/** Display-only JSON tokenization for syntax highlighting. */
export function tokenizeJsonSyntax(value: string): JsonSyntaxPart[] {
  const parts: JsonSyntaxPart[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(jsonTokenRegex)) {
    const token = match[0];
    const start = match.index ?? 0;
    const nextNonWhitespace = value.slice(start + token.length).match(/\S/)?.[0];
    const isKey = token.startsWith('"') && nextNonWhitespace === ':';

    if (start > lastIndex) {
      parts.push({
        text: value.slice(lastIndex, start),
        color: CODE_EDITOR_DEFAULT_TEXT_COLOR,
      });
    }

    parts.push({
      text: token,
      color: getJsonTokenColor(token, isKey),
    });

    lastIndex = start + token.length;
  }

  if (lastIndex < value.length) {
    parts.push({
      text: value.slice(lastIndex),
      color: CODE_EDITOR_DEFAULT_TEXT_COLOR,
    });
  }

  if (parts.length === 0) {
    parts.push({
      text: '{"key": "value"}',
      color: '#6B7280',
    });
  }

  return parts;
}
