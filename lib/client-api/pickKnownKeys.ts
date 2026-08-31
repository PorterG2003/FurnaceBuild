/**
 * Keep only known keys from a request body (strip unknown properties).
 * Preserves `null` and explicit `undefined` omission via `hasOwnProperty`.
 */
export function pickKnownKeys<T extends Record<string, unknown> = Record<string, unknown>>(
  body: Record<string, unknown>,
  keys: readonly string[],
): T {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      out[key] = body[key];
    }
  }
  return out as T;
}

export const CAMPAIGN_CREATE_KEYS = [
  'name',
  'schedule',
  'sending_interval_seconds',
  'lifecycle_schedule',
  'mailbox_ids',
  'tag_ids',
  'flow',
] as const;

export const CAMPAIGN_UPDATE_KEYS = [
  'name',
  'schedule',
  'sending_interval_seconds',
  'lifecycle_schedule',
  'mailbox_ids',
  'add_mailbox_ids',
  'remove_mailbox_ids',
  'tag_ids',
  'add_tag_ids',
  'remove_tag_ids',
] as const;

export const LEAD_WRITE_KEYS = [
  'email',
  'name',
  'first_name',
  'last_name',
  'company_name',
  'website',
  'linkedin_url',
  'company_linkedin_url',
  'phone_number',
  'mobile_phone_number',
  'custom_lead_data',
  'tags',
  'email_verification',
] as const;

export const PERSON_UPDATE_KEYS = [
  'name',
  'first_name',
  'last_name',
  'company_name',
] as const;

export const GLOBAL_LEAD_IDS_KEYS = ['global_lead_ids'] as const;

export const IMPORT_JOB_CREATE_KEYS = [
  'operation',
  'campaign_id',
  'global_lead_ids',
  'list_id',
  'leads',
  'scope',
  'exclusions',
  'preview_id',
  'expected_count',
  'upload_id',
  'source_campaign_id',
  'target_list_id',
  'column_layout',
  'filename_base',
  'projection',
] as const;

export const FLOW_UPDATE_KEYS = [
  'nodes',
  'edges',
] as const;

export const REPLACE_LEAD_KEYS = [
  'new_email',
  'new_name',
  'new_first_name',
  'new_last_name',
  'new_phone_number',
  'new_mobile_phone_number',
  'reason',
  'reason_note',
  'source_message_id',
  'forward_message_id',
] as const;
