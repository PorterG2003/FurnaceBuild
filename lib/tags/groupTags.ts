import type { TagLike } from './types';

const BUILTIN_GROUP_ORDER = ['Provider', 'Signal', 'Other'];

export type TagGroupBucket<T extends TagLike> = {
  groupName: string | null;
  tags: T[];
};

export function groupTagsByName<T extends TagLike>(tags: T[]): TagGroupBucket<T>[] {
  const buckets = new Map<string | null, T[]>();
  for (const tag of tags) {
    const key = tag.groupName?.trim() || null;
    const list = buckets.get(key) ?? [];
    list.push(tag);
    buckets.set(key, list);
  }

  const named = [...buckets.entries()].filter(([name]) => name != null) as Array<[string, T[]]>;
  named.sort((a, b) => {
    const ai = BUILTIN_GROUP_ORDER.indexOf(a[0]);
    const bi = BUILTIN_GROUP_ORDER.indexOf(b[0]);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    }
    return a[0].localeCompare(b[0]);
  });

  const result: TagGroupBucket<T>[] = named.map(([groupName, groupTags]) => ({
    groupName,
    tags: groupTags,
  }));
  const ungrouped = buckets.get(null);
  if (ungrouped?.length) {
    result.push({ groupName: null, tags: ungrouped });
  }
  return result;
}
