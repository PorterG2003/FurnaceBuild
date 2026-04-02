import type { ExportCompanyChainPeopleRow } from '@/lib/foundry/registry-types';

function compactText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

function normalizePersonNameKey(row: ExportCompanyChainPeopleRow): string {
  const fullName = compactText(row.person_name);
  if (fullName) return fullName.toLowerCase();
  const fallbackName = compactText([row.person_first_name, row.person_last_name].filter(Boolean).join(' '));
  return fallbackName ? fallbackName.toLowerCase() : 'unknown-person';
}

function pushDistinct(target: string[], seen: Set<string>, value: string | null | undefined): void {
  const normalized = compactText(value);
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  target.push(normalized);
}

export function getExportChainPeopleMergeKey(row: ExportCompanyChainPeopleRow): string {
  return `${row.company_entity_match_id}:${normalizePersonNameKey(row)}`;
}

export function mergeExportChainPeopleRows(rows: ExportCompanyChainPeopleRow[]): ExportCompanyChainPeopleRow[] {
  const grouped = new Map<
    string,
    {
      base: ExportCompanyChainPeopleRow;
      ownerIds: string[];
      ownerIdKeys: Set<string>;
      roles: string[];
      roleKeys: Set<string>;
      paths: string[];
      pathKeys: Set<string>;
      minDepth: number;
    }
  >();

  for (const row of rows) {
    const key = getExportChainPeopleMergeKey(row);
    const existing = grouped.get(key);
    if (!existing) {
      const ownerIds: string[] = [];
      const roles: string[] = [];
      const paths: string[] = [];
      const ownerIdKeys = new Set<string>();
      const roleKeys = new Set<string>();
      const pathKeys = new Set<string>();
      pushDistinct(ownerIds, ownerIdKeys, row.person_owner_row_id);
      pushDistinct(roles, roleKeys, row.person_title_role);
      pushDistinct(paths, pathKeys, row.linkage_path);
      grouped.set(key, {
        base: { ...row },
        ownerIds,
        ownerIdKeys,
        roles,
        roleKeys,
        paths,
        pathKeys,
        minDepth: row.chain_depth,
      });
      continue;
    }

    pushDistinct(existing.ownerIds, existing.ownerIdKeys, row.person_owner_row_id);
    pushDistinct(existing.roles, existing.roleKeys, row.person_title_role);
    pushDistinct(existing.paths, existing.pathKeys, row.linkage_path);
    existing.minDepth = Math.min(existing.minDepth, row.chain_depth);
    if (!existing.base.person_first_name && row.person_first_name) existing.base.person_first_name = row.person_first_name;
    if (!existing.base.person_last_name && row.person_last_name) existing.base.person_last_name = row.person_last_name;
    existing.base.has_current_linked_source = existing.base.has_current_linked_source || row.has_current_linked_source;
    existing.base.has_current_owner = existing.base.has_current_owner || row.has_current_owner;
    existing.base.has_open_review_task = existing.base.has_open_review_task || row.has_open_review_task;
    existing.base.has_parse_failure_task = existing.base.has_parse_failure_task || row.has_parse_failure_task;
    existing.base.is_export_ready = existing.base.is_export_ready || row.is_export_ready;
  }

  return [...grouped.values()].map(({ base, ownerIds, roles, paths, minDepth }) => ({
    ...base,
    person_owner_row_id: ownerIds.join(','),
    person_title_role: roles.length > 0 ? roles.join(', ') : null,
    linkage_path: paths.join(' | '),
    chain_depth: minDepth,
  }));
}
