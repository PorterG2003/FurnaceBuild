type PersonRow = Record<string, unknown>;

/** Public person shape for list, detail, and PATCH responses. */
export type PublicPerson = {
  global_lead_id: string;
  email: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  campaign_count: number;
  company_list: string | null;
  has_reply: boolean;
  latest_activity_at: string | null;
  newest_membership_created_at: string | null;
  account_id?: string;
  native_campaign_count?: number;
  smartlead_campaign_count?: number;
  updated_at?: string;
};

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

/**
 * Normalize list RPC rows and `account_lead_people` table rows into one shape.
 * Maps list-only `latest_activity` → `latest_activity_at`. Drops per-row `total_count`
 * and internal `search_text`.
 */
export function toPersonResponse(row: PersonRow): PublicPerson {
  const latestActivityAt =
    asNullableString(row.latest_activity_at) ?? asNullableString(row.latest_activity);

  const person: PublicPerson = {
    global_lead_id: String(row.global_lead_id ?? ''),
    email: asNullableString(row.email),
    display_name: asNullableString(row.display_name),
    first_name: asNullableString(row.first_name),
    last_name: asNullableString(row.last_name),
    campaign_count: Number(row.campaign_count ?? 0),
    company_list: asNullableString(row.company_list),
    has_reply: Boolean(row.has_reply),
    latest_activity_at: latestActivityAt,
    newest_membership_created_at: asNullableString(row.newest_membership_created_at),
  };

  if (row.account_id != null) person.account_id = String(row.account_id);
  if (row.native_campaign_count != null) {
    person.native_campaign_count = Number(row.native_campaign_count);
  }
  if (row.smartlead_campaign_count != null) {
    person.smartlead_campaign_count = Number(row.smartlead_campaign_count);
  }
  if (row.updated_at != null) person.updated_at = String(row.updated_at);

  return person;
}
