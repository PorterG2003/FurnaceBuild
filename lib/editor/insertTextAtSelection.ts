export type TextSelection = { start: number; end: number };

export function insertTextAtSelection(
  text: string,
  selection: TextSelection,
  insert: string
): { text: string; selection: TextSelection } {
  const before = text.slice(0, selection.start);
  const after = text.slice(selection.end);
  const nextText = before + insert + after;
  const cursor = selection.start + insert.length;
  return { text: nextText, selection: { start: cursor, end: cursor } };
}
