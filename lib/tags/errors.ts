import type { TagLike } from './types';

export interface TagErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

export function findTagByName(
  tags: TagLike[],
  name: string,
  excludeId?: string,
): TagLike | undefined {
  const normalized = normalizeTagName(name);
  if (!normalized) return undefined;
  return tags.find(
    (tag) => tag.id !== excludeId && normalizeTagName(tag.name) === normalized,
  );
}

export function getTagDuplicateNameMessage(name: string): string {
  const trimmed = name.trim();
  return trimmed
    ? `A tag named "${trimmed}" already exists.`
    : 'A tag with this name already exists.';
}

function isTagNameDuplicateError(error: TagErrorLike | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  const details = typeof error?.details === 'string' ? error.details : '';
  const hint = typeof error?.hint === 'string' ? error.hint : '';
  const combined = [message, details, hint].join('\n');

  if (code !== '23505') return false;

  return (
    /account_id.*name|duplicate key|unique constraint/i.test(combined) ||
    /_(mailbox|campaign|thread)_tags_account_id_name/i.test(combined)
  );
}

export function getTagCreateErrorMessage(
  error: TagErrorLike | null | undefined,
  attemptedName?: string,
): string {
  if (isTagNameDuplicateError(error)) {
    return getTagDuplicateNameMessage(attemptedName ?? '');
  }

  return "Couldn't create tag. Try again.";
}

export function getTagUpdateErrorMessage(
  error: TagErrorLike | null | undefined,
  attemptedName?: string,
): string {
  if (isTagNameDuplicateError(error)) {
    return getTagDuplicateNameMessage(attemptedName ?? '');
  }

  return "Couldn't save tag changes. Try again.";
}

function formatTagNameList(names: string[]): string {
  if (names.length === 0) return 'These tags';
  if (names.length === 1) return `"${names[0]}"`;
  if (names.length === 2) return `"${names[0]}" and "${names[1]}"`;
  const head = names.slice(0, -1).map((name) => `"${name}"`).join(', ');
  return `${head}, and "${names[names.length - 1]}"`;
}

export function formatBulkMailboxTagConflictMessage(
  conflictTagIds: string[],
  accountTags: TagLike[],
): string {
  if (conflictTagIds.length === 0) {
    return "Remove a tag from either the add or remove list — a tag can't be in both.";
  }

  const tagById = new Map(accountTags.map((tag) => [tag.id, tag.name]));
  const names = conflictTagIds.map((id) => tagById.get(id) ?? 'Unknown tag');

  if (names.length === 1) {
    return `Remove ${formatTagNameList(names)} from either the add or remove list — a tag can't be in both.`;
  }

  return `${formatTagNameList(names)} are in both lists. Remove each from one list.`;
}
