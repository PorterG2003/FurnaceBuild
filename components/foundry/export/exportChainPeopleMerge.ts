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

const EMAIL_SLOTS = ['contact_email_1', 'contact_email_2', 'contact_email_3'] as const;

/** Phone, line type, DNC flag, DNC detail JSON text — kept aligned when deduping numbers across merged rows. */
const PHONE_SLOT_QUADS: [
  keyof ExportCompanyChainPeopleRow,
  keyof ExportCompanyChainPeopleRow,
  keyof ExportCompanyChainPeopleRow,
  keyof ExportCompanyChainPeopleRow,
][] = [
  ['contact_phone_1', 'contact_phone_1_type', 'contact_phone_1_is_dnc', 'contact_phone_1_dnc_summary'],
  ['contact_phone_2', 'contact_phone_2_type', 'contact_phone_2_is_dnc', 'contact_phone_2_dnc_summary'],
  ['contact_phone_3', 'contact_phone_3_type', 'contact_phone_3_is_dnc', 'contact_phone_3_dnc_summary'],
];

function readNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  return null;
}

/** Merge up to 3 distinct emails and phones across collapsed chain rows; pick confidence from first row that has it. */
function mergeContactColumnsFromRows(
  constituents: ExportCompanyChainPeopleRow[],
): Partial<ExportCompanyChainPeopleRow> {
  const emails: string[] = [];
  const seenEmail = new Set<string>();
  outerE: for (const r of constituents) {
    for (const ek of EMAIL_SLOTS) {
      const v = r[ek];
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seenEmail.has(k)) continue;
      seenEmail.add(k);
      emails.push(t);
      if (emails.length >= 3) break outerE;
    }
  }

  const phones: string[] = [];
  const types: Array<string | null> = [];
  const dncFlags: Array<boolean | null> = [];
  const dncSummaries: Array<string | null> = [];
  const seenPhone = new Set<string>();
  outerP: for (const r of constituents) {
    for (const [pk, tk, dk, sk] of PHONE_SLOT_QUADS) {
      const pv = r[pk];
      if (typeof pv !== 'string') continue;
      const pt = pv.trim();
      if (!pt) continue;
      const k = pt.toLowerCase();
      if (seenPhone.has(k)) continue;
      seenPhone.add(k);
      phones.push(pt);
      const tv = r[tk];
      types.push(typeof tv === 'string' && tv.trim() ? tv.trim() : null);
      dncFlags.push(readNullableBoolean(r[dk]));
      const sv = r[sk];
      dncSummaries.push(typeof sv === 'string' && sv.trim() ? sv.trim() : null);
      if (phones.length >= 3) break outerP;
    }
  }

  let confidence: Partial<ExportCompanyChainPeopleRow> = {};
  for (const r of constituents) {
    if (
      (r.contact_confidence_tier != null && String(r.contact_confidence_tier).trim() !== '') ||
      r.contact_enrichment_top_score != null
    ) {
      confidence = {
        contact_confidence_tier: r.contact_confidence_tier,
        contact_enrichment_top_score: r.contact_enrichment_top_score,
        contact_enrichment_score_margin: r.contact_enrichment_score_margin,
        contact_enrichment_reason_summary: r.contact_enrichment_reason_summary,
      };
      break;
    }
  }

  const out: Partial<ExportCompanyChainPeopleRow> = { ...confidence };
  if (emails[0]) out.contact_email_1 = emails[0];
  if (emails[1]) out.contact_email_2 = emails[1];
  if (emails[2]) out.contact_email_3 = emails[2];
  if (phones[0]) {
    out.contact_phone_1 = phones[0];
    out.contact_phone_1_type = types[0] ?? null;
    out.contact_phone_1_is_dnc = dncFlags[0] ?? null;
    out.contact_phone_1_dnc_summary = dncSummaries[0] ?? null;
  }
  if (phones[1]) {
    out.contact_phone_2 = phones[1];
    out.contact_phone_2_type = types[1] ?? null;
    out.contact_phone_2_is_dnc = dncFlags[1] ?? null;
    out.contact_phone_2_dnc_summary = dncSummaries[1] ?? null;
  }
  if (phones[2]) {
    out.contact_phone_3 = phones[2];
    out.contact_phone_3_type = types[2] ?? null;
    out.contact_phone_3_is_dnc = dncFlags[2] ?? null;
    out.contact_phone_3_dnc_summary = dncSummaries[2] ?? null;
  }
  return out;
}

export function mergeExportChainPeopleRows(rows: ExportCompanyChainPeopleRow[]): ExportCompanyChainPeopleRow[] {
  const grouped = new Map<
    string,
    {
      base: ExportCompanyChainPeopleRow;
      constituents: ExportCompanyChainPeopleRow[];
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
        constituents: [row],
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

    existing.constituents.push(row);
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

  return [...grouped.values()].map(({ base, constituents, ownerIds, roles, paths, minDepth }) => {
    const contact = mergeContactColumnsFromRows(constituents);
    return {
      ...base,
      ...contact,
      person_owner_row_id: ownerIds.join(','),
      person_title_role: roles.length > 0 ? roles.join(', ') : null,
      linkage_path: paths.join(' | '),
      chain_depth: minDepth,
    };
  });
}
