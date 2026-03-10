import { useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { LeadActivityModal } from './LeadActivityModal';

/** Same as Lead Source Node Modal Insights tab. */
const INSIGHTS_COLUMN_MIN_WIDTH = 160;
const INSIGHTS_COLUMN_MAX_WIDTH = 240;

/** Standard lead fields (from Lead interface). Custom fields from custom_lead_data are not in this set. */
const STANDARD_LEAD_FIELDS = new Set([
  'email',
  'name',
  'first_name',
  'last_name',
  'company_name',
  'website',
  'linkedin_url',
  'company_linkedin_url',
  'phone_number',
  'source',
  'status',
]);

function formatLeadHeaderLabel(fieldKey: string): string {
  if (!STANDARD_LEAD_FIELDS.has(fieldKey)) return fieldKey;
  return fieldKey
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export type EnrollmentStoppedReason = 'replied' | 'bounced' | 'unsubscribed' | 'error';

export type LeadStatus = 'new' | 'processing' | 'completed' | 'failed' | 'paused' | 'removed';

export interface Lead {
  id: string;
  email: string;
  name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  company_linkedin_url?: string | null;
  phone_number?: string | null;
  source?: string | null;
  custom_lead_data?: Record<string, unknown> | null;
  status?: LeadStatus | null;
  enrollment_state: 'active' | 'completed' | 'stopped' | 'paused' | null;
  enrollment_current_node_id: string | null;
  enrollment_stopped_reason: EnrollmentStoppedReason | null;
  enrollment_stopped_error_message: string | null;
  created_at: string;
}

/** Flattened lead row for the table: record fields + __rowKey (lead.id) and __lead for enrollment/row press. */
type LeadTableRow = Record<string, string> & { __rowKey: string; __lead: Lead };

interface LeadsTableProps {
  leads: Lead[];
  loading?: boolean;
  campaignId: string;
  /**
   * When true, no add/edit/delete (or other mutating) actions may be shown.
   * Use this for read-only contexts (e.g. Smartlead campaigns). Any future
   * mutating UI must be hidden or disabled when readOnly is true.
   */
  readOnly?: boolean;
}

const ITEMS_PER_PAGE_OPTIONS = [10, 20, 50, 100, 250];

export function LeadsTable({ leads, loading, campaignId, readOnly = false }: LeadsTableProps) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return leads;
    const q = searchQuery.toLowerCase();
    const match = (s: string | null | undefined) => (s ?? '').toLowerCase().includes(q);
    return leads.filter(
      (lead) =>
        match(lead.email) ||
        match(lead.name) ||
        match(lead.first_name) ||
        match(lead.last_name) ||
        match(lead.company_name) ||
        match(lead.phone_number) ||
        match(lead.website) ||
        match(lead.linkedin_url)
    );
  }, [leads, searchQuery]);

  // Flatten leads to Record<string, string> (same as Lead Source Node Modal Insights tab)
  const leadsForTable = useMemo((): LeadTableRow[] => {
    return filteredLeads.map((lead) => {
      const record: Record<string, string> = {};
      if (lead.email) record.email = lead.email;
      if (lead.name) record.name = lead.name;
      if (lead.first_name) record.first_name = lead.first_name;
      if (lead.last_name) record.last_name = lead.last_name;
      if (lead.company_name) record.company_name = lead.company_name;
      if (lead.website) record.website = lead.website;
      if (lead.linkedin_url) record.linkedin_url = lead.linkedin_url;
      if (lead.company_linkedin_url) record.company_linkedin_url = lead.company_linkedin_url;
      if (lead.phone_number) record.phone_number = lead.phone_number;
      if (lead.source) record.source = lead.source;
      if (lead.status) record.status = lead.status ?? '';
      if (lead.custom_lead_data && typeof lead.custom_lead_data === 'object') {
        Object.entries(lead.custom_lead_data).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            record[key] = String(value);
          }
        });
      }
      return { ...record, __rowKey: lead.id, __lead: lead } as LeadTableRow;
    });
  }, [filteredLeads]);

  // Insight summary: field list with fill percentage (same pattern as modal)
  const insightSummary = useMemo(() => {
    if (!leadsForTable.length) {
      return { totalRows: 0, fields: [] as Array<{ field: string; percentage: number }> };
    }
    const fieldCounts = new Map<string, number>();
    leadsForTable.forEach((row) => {
      Object.entries(row).forEach(([key, value]) => {
        if (key === '__rowKey' || key === '__lead') return;
        if ((value ?? '').toString().trim()) {
          fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
        }
      });
    });
    const totalRows = leadsForTable.length;
    const fields = Array.from(fieldCounts.entries())
      .map(([field, count]) => ({
        field,
        percentage: Math.min(100, Math.round((count / totalRows) * 100)),
      }))
      .sort((a, b) => b.percentage - a.percentage);
    return { totalRows, fields };
  }, [leadsForTable]);

  const stoppedReasonLabel: Record<EnrollmentStoppedReason, string> = {
    replied: 'Replied',
    bounced: 'Bounced',
    unsubscribed: 'Unsubscribed',
    error: 'Error',
  };

  const getStateBadge = (
    state: string | null,
    stoppedReason: EnrollmentStoppedReason | null = null,
    stoppedErrorMessage: string | null = null
  ) => {
    if (!state) {
      return (
        <View className="self-start px-3 py-1.5 rounded-md" style={{ backgroundColor: '#6b728020' }}>
          <Text className="text-xs font-instrument-semibold text-gray-500">Not Started</Text>
        </View>
      );
    }
    const stateConfig: Record<string, { bg: string; text: string; label: string }> = {
      completed: { bg: '#10b98120', text: '#10b981', label: 'Completed' },
      active: { bg: '#3b82f620', text: '#3b82f6', label: 'In Progress' },
      stopped: {
        bg: '#f59e0b20',
        text: '#f59e0b',
        label: stoppedReason ? `Stopped (${stoppedReasonLabel[stoppedReason]})` : 'Stopped',
      },
      paused: { bg: '#8b5cf620', text: '#8b5cf6', label: 'Paused' },
    };
    const colors = stateConfig[state] ?? { bg: '#6b728020', text: '#6b7280', label: state };
    const errorClue =
      state === 'stopped' && stoppedReason === 'error' && stoppedErrorMessage
        ? stoppedErrorMessage.length > 80
          ? `${stoppedErrorMessage.slice(0, 80)}…`
          : stoppedErrorMessage
        : null;
    return (
      <View className="self-start">
        <View className="px-3 py-1.5 rounded-md" style={{ backgroundColor: colors.bg }}>
          <Text className="text-xs font-instrument-semibold" style={{ color: colors.text }}>
            {colors.label}
          </Text>
        </View>
        {errorClue && (
          <Text
            className="text-xs text-gray-500 font-instrument mt-1 max-w-[200px]"
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {errorClue}
          </Text>
        )}
      </View>
    );
  };

  // Dynamic columns from insight summary (same as modal) + optional Enrollment column
  const columns = useMemo((): TableColumn<LeadTableRow>[] => {
    const dataColumns: TableColumn<LeadTableRow>[] = insightSummary.fields.map((f) => {
      const filled = Math.round(insightSummary.totalRows * (f.percentage / 100));
      const empty = insightSummary.totalRows - filled;
      const minFromLabel = Math.ceil(f.field.length * 8);
      const minWidth = Math.min(
        INSIGHTS_COLUMN_MAX_WIDTH,
        Math.max(INSIGHTS_COLUMN_MIN_WIDTH, minFromLabel)
      );
      return {
        key: f.field,
        label: formatLeadHeaderLabel(f.field),
        flex: 0,
        minWidth,
        maxWidth: INSIGHTS_COLUMN_MAX_WIDTH,
        headerStats: { filled, empty },
        sortable: true,
        sortValue: (item) => (item[f.field] ?? '').toLowerCase(),
        render: (item) => (
          <Text className="text-white font-instrument text-sm" numberOfLines={1}>
            {item[f.field] ?? '—'}
          </Text>
        ),
      };
    });
    const enrollmentColumn: TableColumn<LeadTableRow> = {
      key: 'enrollment_state',
      label: 'Enrollment',
      minWidth: 130,
      flex: 0,
      sortable: true,
      sortValue: (item) => item.__lead.enrollment_state || '',
      render: (item) =>
        getStateBadge(
          item.__lead.enrollment_state,
          item.__lead.enrollment_stopped_reason,
          item.__lead.enrollment_stopped_error_message
        ),
    };
    return [...dataColumns, enrollmentColumn];
  }, [insightSummary]);

  return (
    <>
      <View className="flex-row items-center justify-between mb-4 flex-wrap gap-2">
        <Text className="text-lg font-instrument-semibold text-white">Leads</Text>
        <View className="flex-row items-center gap-2 flex-wrap">
          <Text className="text-gray-400 font-instrument text-sm">
            {filteredLeads.length} {filteredLeads.length !== 1 ? 'items' : 'item'}
            {searchQuery.trim() && ` (filtered from ${leads.length} total)`}
          </Text>
          <View className="flex-row items-center gap-1">
            <Text className="text-gray-500 font-instrument text-xs">Per page:</Text>
            {ITEMS_PER_PAGE_OPTIONS.map((n) => (
              <Pressable
                key={n}
                onPress={() => setItemsPerPage(n)}
                className="px-2 py-1 rounded border border-[#2A2A2A] active:opacity-70"
                style={{ backgroundColor: itemsPerPage === n ? '#2A2A2A' : 'transparent' }}
              >
                <Text
                  className={`text-xs font-instrument-medium ${itemsPerPage === n ? 'text-white' : 'text-gray-400'}`}
                >
                  {n}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
      <View className="mb-4">
        <View className="flex-row items-center bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2">
          <MagnifyingGlassIcon size={18} color="#6b7280" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by email, name, company, phone..."
            placeholderTextColor="#6b7280"
            className="flex-1 ml-2 text-white font-instrument text-sm"
          />
        </View>
      </View>
      <DataTable
        items={leadsForTable}
        columns={columns}
        loading={loading}
        itemsPerPage={itemsPerPage}
        equalColumnWidths
        emptyMessage="No leads found"
        onRowPress={(row) => setSelectedLead(row.__lead)}
        getItemKey={(row) => row.__rowKey}
      />

      {selectedLead && (
        <LeadActivityModal
          visible={!!selectedLead}
          onClose={() => setSelectedLead(null)}
          leadId={selectedLead.id}
          campaignId={campaignId}
          leadEmail={selectedLead.email}
          leadName={selectedLead.name}
        />
      )}
    </>
  );
}
