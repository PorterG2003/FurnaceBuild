import type { LeadsColumnCatalogField, LeadsColumnGroupDefinition, LeadsColumnSourceType } from './types';

export const LEADS_COLUMN_GROUPS: LeadsColumnGroupDefinition[] = [
  {
    id: 'person',
    label: 'Lead',
    fields: [
      { fieldKey: 'email', label: 'Email', sourceType: 'person' },
      { fieldKey: 'display_name', label: 'Display name', sourceType: 'person' },
      { fieldKey: 'first_name', label: 'First name', sourceType: 'person' },
      { fieldKey: 'last_name', label: 'Last name', sourceType: 'person' },
    ],
  },
  {
    id: 'rollup',
    label: 'Summary',
    fields: [
      { fieldKey: 'campaign_count', label: 'Campaign count', sourceType: 'rollup' },
      { fieldKey: 'company_list', label: 'Companies', sourceType: 'rollup' },
      { fieldKey: 'has_reply', label: 'Has reply', sourceType: 'rollup' },
      { fieldKey: 'latest_activity', label: 'Latest activity', sourceType: 'rollup' },
      { fieldKey: 'smartlead_count', label: 'Smartlead memberships', sourceType: 'rollup' },
      { fieldKey: 'native_count', label: 'Native memberships', sourceType: 'rollup' },
      { fieldKey: 'interested_count', label: 'Interested campaigns', sourceType: 'rollup' },
    ],
  },
  {
    id: 'membership',
    label: 'Campaign',
    requiresCampaign: true,
    fields: [
      { fieldKey: 'company_name', label: 'Company', sourceType: 'membership' },
      { fieldKey: 'phone', label: 'Company phone', sourceType: 'membership' },
      { fieldKey: 'website', label: 'Website', sourceType: 'membership' },
      { fieldKey: 'mobile_phone', label: 'Mobile', sourceType: 'membership' },
      { fieldKey: 'linkedin_url', label: 'LinkedIn', sourceType: 'membership' },
      { fieldKey: 'title', label: 'Title', sourceType: 'membership' },
      { fieldKey: 'enrollment_state', label: 'Enrollment', sourceType: 'membership' },
      { fieldKey: 'reply_category', label: 'Reply category', sourceType: 'membership' },
      { fieldKey: 'created_at', label: 'Added at', sourceType: 'membership' },
      { fieldKey: 'last_activity', label: 'Last activity', sourceType: 'membership' },
    ],
  },
];

export function getColumnGroupForSourceType(sourceType: LeadsColumnSourceType) {
  return LEADS_COLUMN_GROUPS.find((group) => group.id === sourceType) ?? null;
}

export function getCatalogField(sourceType: LeadsColumnSourceType, fieldKey: string): LeadsColumnCatalogField | null {
  const group = getColumnGroupForSourceType(sourceType);
  return group?.fields.find((field) => field.fieldKey === fieldKey) ?? null;
}

export function buildCatalogSelectionKey(
  sourceType: LeadsColumnSourceType,
  fieldKey: string,
  campaignId?: string | null,
): string {
  if (sourceType === 'membership') {
    return `${sourceType}:${campaignId ?? ''}:${fieldKey}`;
  }
  return `${sourceType}:${fieldKey}`;
}
