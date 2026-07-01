import type { LeadsColumnDef } from './types';

/** Default columns for new saved lists and empty persisted layouts. */
export const DEFAULT_SAVED_LIST_COLUMNS: LeadsColumnDef[] = [
  { id: 'person-email', sourceType: 'person', sourceLabel: 'Lead', fieldKey: 'email', label: 'Email', visible: true, width: 260 },
  { id: 'person-name', sourceType: 'person', sourceLabel: 'Lead', fieldKey: 'display_name', label: 'Name', visible: true, width: 180 },
  { id: 'rollup-campaigns', sourceType: 'rollup', sourceLabel: 'Summary', fieldKey: 'campaign_count', label: 'Campaigns', visible: true, width: 120 },
  { id: 'rollup-companies', sourceType: 'rollup', sourceLabel: 'Summary', fieldKey: 'company_list', label: 'Companies', visible: true, width: 260 },
  { id: 'rollup-reply', sourceType: 'rollup', sourceLabel: 'Summary', fieldKey: 'has_reply', label: 'Has reply', visible: true, width: 120 },
  { id: 'rollup-activity', sourceType: 'rollup', sourceLabel: 'Summary', fieldKey: 'latest_activity', label: 'Last activity', visible: true, width: 160 },
];

/** Explorer uses the same default rollup/person set (fixed, not persisted). */
export const EXPLORER_COLUMNS: LeadsColumnDef[] = DEFAULT_SAVED_LIST_COLUMNS;
