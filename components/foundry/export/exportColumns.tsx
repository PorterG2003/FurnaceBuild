import { Text, View } from 'react-native';
import type { TableColumn } from '@/components/ui/DataTable';
import type { ExportPresentationMode } from '@/components/foundry/export/exportFilterTypes';
import type { ExportRow } from '@/components/foundry/export/exportRows';

export type ExportColumnGroup = 'Company' | 'Location' | 'Contact' | 'System' | 'Google Ads' | 'Cost';

export interface ExportColumnDefinition {
  key: string;
  label: string;
  group: ExportColumnGroup;
  modes: ExportPresentationMode[];
  defaultVisibleFor: ExportPresentationMode[];
  minWidth?: number;
  flex?: number;
  requiresContact?: boolean;
  requiresConfidence?: boolean;
  requiresGoogleAds?: boolean;
  isCost?: boolean;
  render: (row: ExportRow) => React.ReactNode;
  csvValue?: (row: ExportRow) => unknown;
}

function textCell(value: string | number | null | undefined, className = 'text-gray-200 font-instrument text-sm') {
  return (
    <Text className={className} numberOfLines={2}>
      {value == null || value === '' ? '—' : String(value)}
    </Text>
  );
}

function boolCell(value: boolean, positiveLabel = 'Y', negativeLabel = '—', warn = false) {
  const cls = warn && value ? 'text-red-400/90' : value ? 'text-emerald-400/90' : 'text-gray-500';
  return (
    <Text className={`font-instrument text-xs ${cls}`} numberOfLines={1}>
      {value ? positiveLabel : negativeLabel}
    </Text>
  );
}

function formatAddress(row: ExportRow): string | null {
  const parts = [
    row.address_line_1,
    row.address_line_2,
    row.address_city,
    row.address_state,
    row.address_postal_code,
    row.address_country,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

function costValue(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value.toFixed(4).replace(/\.?0+$/, '');
}

export const EXPORT_COLUMN_DEFINITIONS: ExportColumnDefinition[] = [
  {
    key: 'company_name',
    label: 'Company',
    group: 'Company',
    modes: ['contact', 'company'],
    defaultVisibleFor: ['contact', 'company'],
    minWidth: 220,
    flex: 1.2,
    render: (row) => (
      <View className="min-w-0">
        <Text className="text-white font-instrument text-sm" numberOfLines={2}>
          {row.company_name}
        </Text>
        {row.normalized_key ? (
          <Text className="text-gray-500 font-instrument text-xs mt-0.5" numberOfLines={1}>
            {row.normalized_key}
          </Text>
        ) : null}
      </View>
    ),
    csvValue: (row) => row.company_name,
  },
  {
    key: 'person_name',
    label: 'Contact',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: ['contact'],
    minWidth: 180,
    flex: 1,
    render: (row) => textCell(row.person_name),
  },
  {
    key: 'person_title_role',
    label: 'Title',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: ['contact'],
    minWidth: 180,
    flex: 0.95,
    render: (row) => textCell(row.person_title_role),
  },
  {
    key: 'linkage_path',
    label: 'Linkage path',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 300,
    flex: 1.4,
    render: (row) => textCell(row.linkage_path, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'chain_depth',
    label: 'Depth',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 84,
    render: (row) => textCell(row.chain_depth),
  },
  {
    key: 'website',
    label: 'Website',
    group: 'Company',
    modes: ['contact', 'company'],
    defaultVisibleFor: ['contact', 'company'],
    minWidth: 180,
    flex: 0.9,
    render: (row) => textCell(row.website, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'listing_phone',
    label: 'Listing phone',
    group: 'Company',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 150,
    flex: 0.85,
    render: (row) => textCell(row.listing_phone, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'address',
    label: 'Address',
    group: 'Location',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 240,
    flex: 1.2,
    render: (row) => textCell(formatAddress(row), 'text-gray-400 font-instrument text-xs'),
    csvValue: (row) => formatAddress(row),
  },
  {
    key: 'address_city',
    label: 'City',
    group: 'Location',
    modes: ['contact', 'company'],
    defaultVisibleFor: ['contact', 'company'],
    minWidth: 140,
    render: (row) => textCell(row.address_city),
  },
  {
    key: 'address_state',
    label: 'State',
    group: 'Location',
    modes: ['contact', 'company'],
    defaultVisibleFor: ['contact', 'company'],
    minWidth: 90,
    render: (row) => textCell(row.address_state ?? row.registry_state),
    csvValue: (row) => row.address_state ?? row.registry_state,
  },
  {
    key: 'address_postal_code',
    label: 'Postal',
    group: 'Location',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 110,
    render: (row) => textCell(row.address_postal_code),
  },
  {
    key: 'primary_location_city',
    label: 'Primary city',
    group: 'Location',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 140,
    render: (row) => textCell(row.primary_location_city),
  },
  {
    key: 'primary_location_state',
    label: 'Primary state',
    group: 'Location',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 110,
    render: (row) => textCell(row.primary_location_state),
  },
  {
    key: 'registry_state',
    label: 'Registry state',
    group: 'System',
    modes: ['contact', 'company'],
    defaultVisibleFor: ['contact', 'company'],
    minWidth: 110,
    render: (row) => textCell(row.registry_state),
  },
  {
    key: 'registry_entity_id',
    label: 'Registry entity',
    group: 'System',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 160,
    render: (row) => textCell(row.registry_entity_id, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'state_entity_legal_name',
    label: 'State entity',
    group: 'System',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 200,
    flex: 1,
    render: (row) => textCell(row.state_entity_legal_name),
  },
  {
    key: 'linked_source_count',
    label: 'Linked sources',
    group: 'Company',
    modes: ['contact', 'company'],
    defaultVisibleFor: ['company'],
    minWidth: 110,
    render: (row) => textCell(row.linked_source_count),
  },
  {
    key: 'has_current_linked_source',
    label: 'Linked',
    group: 'System',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 70,
    render: (row) => boolCell(row.has_current_linked_source),
  },
  {
    key: 'has_current_owner',
    label: 'Has owner',
    group: 'System',
    modes: ['contact', 'company'],
    defaultVisibleFor: ['company'],
    minWidth: 90,
    render: (row) => boolCell(row.has_current_owner),
  },
  {
    key: 'has_open_review_task',
    label: 'Review',
    group: 'System',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 70,
    render: (row) => boolCell(row.has_open_review_task, 'Y', '—', true),
  },
  {
    key: 'has_parse_failure_task',
    label: 'Parse',
    group: 'System',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 70,
    render: (row) => boolCell(row.has_parse_failure_task, 'Y', '—', true),
  },
  {
    key: 'is_export_ready',
    label: 'Ready',
    group: 'System',
    modes: ['contact', 'company'],
    defaultVisibleFor: ['contact', 'company'],
    minWidth: 80,
    render: (row) => boolCell(row.is_export_ready, 'Ready', 'No'),
  },
  {
    key: 'company_notes',
    label: 'Notes',
    group: 'Company',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 220,
    flex: 1,
    render: (row) => textCell(row.company_notes, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'company_updated_at',
    label: 'Company updated',
    group: 'Company',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 150,
    render: (row) => textCell(row.company_updated_at, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_email_1',
    label: 'Email 1',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 220,
    requiresContact: true,
    render: (row) => textCell(row.contact_email_1, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_email_2',
    label: 'Email 2',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 220,
    requiresContact: true,
    render: (row) => textCell(row.contact_email_2, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_email_3',
    label: 'Email 3',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 220,
    requiresContact: true,
    render: (row) => textCell(row.contact_email_3, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_phone_1',
    label: 'Phone 1',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 160,
    requiresContact: true,
    render: (row) => textCell(row.contact_phone_1),
  },
  {
    key: 'contact_phone_1_type',
    label: 'Phone 1 type',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 120,
    requiresContact: true,
    render: (row) => textCell(row.contact_phone_1_type, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_phone_2',
    label: 'Phone 2',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 160,
    requiresContact: true,
    render: (row) => textCell(row.contact_phone_2),
  },
  {
    key: 'contact_phone_2_type',
    label: 'Phone 2 type',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 120,
    requiresContact: true,
    render: (row) => textCell(row.contact_phone_2_type, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_phone_3',
    label: 'Phone 3',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 160,
    requiresContact: true,
    render: (row) => textCell(row.contact_phone_3),
  },
  {
    key: 'contact_phone_3_type',
    label: 'Phone 3 type',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 120,
    requiresContact: true,
    render: (row) => textCell(row.contact_phone_3_type, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_phone_1_is_dnc',
    label: 'Phone 1 DNC',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 100,
    requiresContact: true,
    render: (row) =>
      textCell(
        row.contact_phone_1_is_dnc == null ? null : row.contact_phone_1_is_dnc ? 'Y' : 'N',
        'text-gray-400 font-instrument text-xs',
      ),
    csvValue: (row) =>
      row.contact_phone_1_is_dnc == null ? '' : row.contact_phone_1_is_dnc ? 'Y' : 'N',
  },
  {
    key: 'contact_phone_1_dnc_summary',
    label: 'Phone 1 DNC note',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 180,
    requiresContact: true,
    render: (row) => textCell(row.contact_phone_1_dnc_summary, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_phone_2_is_dnc',
    label: 'Phone 2 DNC',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 100,
    requiresContact: true,
    render: (row) =>
      textCell(
        row.contact_phone_2_is_dnc == null ? null : row.contact_phone_2_is_dnc ? 'Y' : 'N',
        'text-gray-400 font-instrument text-xs',
      ),
    csvValue: (row) =>
      row.contact_phone_2_is_dnc == null ? '' : row.contact_phone_2_is_dnc ? 'Y' : 'N',
  },
  {
    key: 'contact_phone_2_dnc_summary',
    label: 'Phone 2 DNC note',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 180,
    requiresContact: true,
    render: (row) => textCell(row.contact_phone_2_dnc_summary, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_phone_3_is_dnc',
    label: 'Phone 3 DNC',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 100,
    requiresContact: true,
    render: (row) =>
      textCell(
        row.contact_phone_3_is_dnc == null ? null : row.contact_phone_3_is_dnc ? 'Y' : 'N',
        'text-gray-400 font-instrument text-xs',
      ),
    csvValue: (row) =>
      row.contact_phone_3_is_dnc == null ? '' : row.contact_phone_3_is_dnc ? 'Y' : 'N',
  },
  {
    key: 'contact_phone_3_dnc_summary',
    label: 'Phone 3 DNC note',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 180,
    requiresContact: true,
    render: (row) => textCell(row.contact_phone_3_dnc_summary, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'contact_confidence_tier',
    label: 'Confidence',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 110,
    requiresContact: true,
    requiresConfidence: true,
    render: (row) => textCell(row.contact_confidence_tier),
  },
  {
    key: 'contact_enrichment_top_score',
    label: 'Top score',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 100,
    requiresContact: true,
    requiresConfidence: true,
    render: (row) => textCell(row.contact_enrichment_top_score),
  },
  {
    key: 'contact_enrichment_score_margin',
    label: 'Score margin',
    group: 'Contact',
    modes: ['contact'],
    defaultVisibleFor: [],
    minWidth: 110,
    requiresContact: true,
    requiresConfidence: true,
    render: (row) => textCell(row.contact_enrichment_score_margin),
  },
  {
    key: 'google_ads_verification_result',
    label: 'Google Ads',
    group: 'Google Ads',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 110,
    requiresGoogleAds: true,
    render: (row) => textCell(row.google_ads_verification_result),
  },
  {
    key: 'google_ads_search_domain',
    label: 'Ads domain',
    group: 'Google Ads',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 180,
    requiresGoogleAds: true,
    render: (row) => textCell(row.google_ads_search_domain, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'google_ads_matched_advertiser_name',
    label: 'Matched advertiser',
    group: 'Google Ads',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 220,
    flex: 1,
    requiresGoogleAds: true,
    render: (row) => textCell(row.google_ads_matched_advertiser_name),
  },
  {
    key: 'google_ads_verified_at',
    label: 'Ads verified',
    group: 'Google Ads',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 160,
    requiresGoogleAds: true,
    render: (row) => textCell(row.google_ads_verified_at, 'text-gray-400 font-instrument text-xs'),
  },
  {
    key: 'company_acquisition_cost_cents',
    label: 'Acq cost',
    group: 'Cost',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 110,
    isCost: true,
    render: (row) => textCell(costValue(row.company_acquisition_cost_cents)),
    csvValue: (row) => costValue(row.company_acquisition_cost_cents),
  },
  {
    key: 'company_enrichment_cost_cents',
    label: 'Enrich cost',
    group: 'Cost',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 120,
    isCost: true,
    render: (row) => textCell(costValue(row.company_enrichment_cost_cents)),
    csvValue: (row) => costValue(row.company_enrichment_cost_cents),
  },
  {
    key: 'total_cost_per_row_cents',
    label: 'Total / row',
    group: 'Cost',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 110,
    isCost: true,
    render: (row) => textCell(costValue(row.total_cost_per_row_cents)),
    csvValue: (row) => costValue(row.total_cost_per_row_cents),
  },
  {
    key: 'company_export_row_count',
    label: 'Cost rows',
    group: 'Cost',
    modes: ['contact', 'company'],
    defaultVisibleFor: [],
    minWidth: 90,
    isCost: true,
    render: (row) => textCell(row.company_export_row_count),
  },
];

export const EXPORT_COLUMNS_BY_KEY = new Map(EXPORT_COLUMN_DEFINITIONS.map((column) => [column.key, column]));

export function getDefaultExportColumnKeys(mode: ExportPresentationMode): string[] {
  return EXPORT_COLUMN_DEFINITIONS.filter((column) => column.defaultVisibleFor.includes(mode)).map((column) => column.key);
}

export function getExportColumnGroups(mode: ExportPresentationMode): Array<{ group: ExportColumnGroup; columns: ExportColumnDefinition[] }> {
  const visibleColumns = EXPORT_COLUMN_DEFINITIONS.filter((column) => column.modes.includes(mode));
  const groups: ExportColumnGroup[] = ['Company', 'Location', 'Contact', 'System', 'Google Ads', 'Cost'];
  return groups
    .map((group) => ({
      group,
      columns: visibleColumns.filter((column) => column.group === group),
    }))
    .filter((group) => group.columns.length > 0);
}

export function getRequiredExportIncludes(
  visibleColumnKeys: string[],
  includeCost: boolean,
): {
  includeContact: boolean;
  includeContactConfidence: boolean;
  includeGoogleAdsVerification: boolean;
  includeCost: boolean;
} {
  const columns = visibleColumnKeys
    .map((key) => EXPORT_COLUMNS_BY_KEY.get(key))
    .filter((column): column is ExportColumnDefinition => Boolean(column));

  const includeContact = columns.some((column) => column.requiresContact);
  const includeContactConfidence = columns.some((column) => column.requiresConfidence);
  const includeGoogleAdsVerification = columns.some((column) => column.requiresGoogleAds);
  const includeCostForRequest = includeCost && columns.some((column) => column.isCost);

  return {
    includeContact,
    includeContactConfidence,
    includeGoogleAdsVerification,
    includeCost: includeCostForRequest,
  };
}

export function getVisibleExportTableColumns(
  visibleColumnKeys: string[],
  mode: ExportPresentationMode,
): TableColumn<ExportRow>[] {
  return visibleColumnKeys
    .map((key) => EXPORT_COLUMNS_BY_KEY.get(key))
    .filter((column): column is ExportColumnDefinition => column != null && column.modes.includes(mode))
    .map((column) => ({
      key: column.key,
      label: column.label,
      minWidth: column.minWidth,
      flex: column.flex,
      render: column.render,
    }));
}
