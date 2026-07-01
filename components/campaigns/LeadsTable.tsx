import { useState, useMemo, type ReactNode } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { MagnifyingGlassIcon, UserIcon } from 'react-native-heroicons/outline';
import { DataTable, type TableColumn } from '@/components/ui/DataTable';
import { LeadActivityModal } from './LeadActivityModal';
import type { CampaignLeadTableRow } from '@/lib/supabase/services/leads';
import { openLeadDetail } from '@/lib/leads/navigation';

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
  'mobile_phone_number',
  'source',
]);

function formatLeadHeaderLabel(fieldKey: string): string {
  if (!STANDARD_LEAD_FIELDS.has(fieldKey)) return fieldKey;
  if (fieldKey === 'phone_number') return 'Company Phone';
  if (fieldKey === 'mobile_phone_number') return 'Mobile';
  return fieldKey
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export type EnrollmentStoppedReason = 'replied' | 'bounced' | 'unsubscribed' | 'error';

export type Lead = CampaignLeadTableRow;

/** Flattened lead row for the table: record fields + __rowKey (lead.id) and __lead for enrollment/row press. */
type LeadTableRow = Record<string, string> & { __rowKey: string; __lead: Lead };

interface LeadsTableProps {
  leads: Lead[];
  loading?: boolean;
  campaignId: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  currentPage: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSortChange?: (columnKey: string, direction: 'asc' | 'desc') => void;
  /**
   * When true, no add/edit/delete (or other mutating) actions may be shown.
   * Use this for read-only contexts (e.g. Smartlead campaigns). Any future
   * mutating UI must be hidden or disabled when readOnly is true.
   */
  readOnly?: boolean;
  /** When true with `selectedKeys` / `onSelectionChange`, shows row checkboxes with view-wide select-all. */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  onFetchViewKeys?: () => Promise<string[]>;
  headerSummary?: ReactNode;
  headerActions?: ReactNode;
}

const SERVER_SORTABLE_FIELDS = new Set([
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
  'source',
]);

export function LeadsTable({
  leads,
  loading,
  campaignId,
  searchQuery,
  onSearchChange,
  currentPage,
  totalItems,
  onPageChange,
  sortColumn,
  sortDirection,
  onSortChange,
  readOnly = false,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  onFetchViewKeys,
  headerSummary,
  headerActions,
}: LeadsTableProps) {
  const router = useRouter();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const selectionActive = selectable && selectedKeys != null && selectedKeys.size > 0;

  // Flatten leads to Record<string, string> (same as Lead Source Node Modal Insights tab)
  const leadsForTable = useMemo((): LeadTableRow[] => {
    return leads.map((lead) => {
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
      if (lead.mobile_phone_number) record.mobile_phone_number = lead.mobile_phone_number;
      if (lead.source) record.source = lead.source;
      if (lead.custom_lead_data && typeof lead.custom_lead_data === 'object') {
        Object.entries(lead.custom_lead_data).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            record[key] = String(value);
          }
        });
      }
      return { ...record, __rowKey: lead.id, __lead: lead } as LeadTableRow;
    });
  }, [leads]);

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
    if (!state || state === 'not_started') {
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
            <Text
              className="text-xs font-instrument-semibold"
              numberOfLines={1}
              style={{ color: colors.text }}
            >
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

  const getReplyCategoryBadge = (replyCategory: Lead['reply_category']) => {
    const config =
      replyCategory === 'Interested'
        ? { bg: '#34D39922', text: '#34D399', label: 'Interested' }
        : replyCategory === 'Neutral'
          ? { bg: '#94A3B822', text: '#94A3B8', label: 'Neutral' }
          : replyCategory === 'Not Interested'
            ? { bg: '#EA580C22', text: '#EA580C', label: 'Not Interested' }
            : { bg: '#6b728020', text: '#9ca3af', label: 'Not Categorized' };

    return (
      <View className="self-start px-3 py-1.5 rounded-md" style={{ backgroundColor: config.bg }}>
        <Text className="text-xs font-instrument-semibold" style={{ color: config.text }}>
          {config.label}
        </Text>
      </View>
    );
  };

  const getReplacementBadge = (lead: Lead) => {
    if (!lead.replacement_role) {
      return (
        <Text className="text-xs font-instrument text-gray-500">
          —
        </Text>
      );
    }

    const label =
      lead.replacement_role === 'new'
        ? `Replaces ${lead.replacement_counterpart_label || lead.replacement_counterpart_email || 'previous lead'}`
        : `Replaced by ${lead.replacement_counterpart_label || lead.replacement_counterpart_email || 'new lead'}`;

    return (
      <View className="self-start">
        <View
          className="self-start px-3 py-1.5 rounded-md"
          style={{ backgroundColor: 'rgba(249, 115, 22, 0.12)' }}
        >
          <Text className="text-xs font-instrument-semibold" style={{ color: '#FDBA74' }}>
            {label}
          </Text>
        </View>
        {lead.replacement_reason_note ? (
          <Text
            className="text-xs text-gray-500 font-instrument mt-1 max-w-[220px]"
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {lead.replacement_reason_note}
          </Text>
        ) : null}
      </View>
    );
  };

  // Dynamic columns from insight summary (same as modal) + fixed campaign columns
  const columns = useMemo((): TableColumn<LeadTableRow>[] => {
    const dataColumns: TableColumn<LeadTableRow>[] = insightSummary.fields.map((f) => {
      const filled = Math.round(insightSummary.totalRows * (f.percentage / 100));
      const empty = insightSummary.totalRows - filled;
      const minFromLabel = Math.ceil(f.field.length * 8);
      const minWidth = Math.min(
        INSIGHTS_COLUMN_MAX_WIDTH,
        Math.max(INSIGHTS_COLUMN_MIN_WIDTH, minFromLabel)
      );
      const isSortable = SERVER_SORTABLE_FIELDS.has(f.field);
      return {
        key: f.field,
        label: formatLeadHeaderLabel(f.field),
        flex: 0,
        minWidth,
        maxWidth: INSIGHTS_COLUMN_MAX_WIDTH,
        headerStats: { filled, empty },
        sortable: isSortable,
        sortValue: isSortable ? (item) => (item[f.field] ?? '').toLowerCase() : undefined,
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
      minWidth: 176,
      flex: 0,
      render: (item) =>
        getStateBadge(
          item.__lead.enrollment_progress_state,
          item.__lead.enrollment_stopped_reason,
          item.__lead.enrollment_stopped_error_message
        ),
    };
    const replyCategoryColumn: TableColumn<LeadTableRow> = {
      key: 'reply_category',
      label: 'Reply Category',
      minWidth: 164,
      flex: 0,
      render: (item) => getReplyCategoryBadge(item.__lead.reply_category),
    };
    const replacementColumn: TableColumn<LeadTableRow> = {
      key: 'replacement',
      label: 'Replacement',
      minWidth: 240,
      flex: 0,
      render: (item) => getReplacementBadge(item.__lead),
    };
    const viewLeadColumn: TableColumn<LeadTableRow> = {
      key: 'view_lead',
      label: '',
      minWidth: 52,
      flex: 0,
      render: (item) => (
        <Pressable
          accessibilityLabel="View lead"
          className="p-2 rounded-lg items-center justify-center"
          onPress={() => {
            void openLeadDetail(router, {
              globalLeadId: item.__lead.global_lead_id ?? undefined,
              leadId: item.__lead.id,
              campaignId,
              from: 'campaign',
            });
          }}
        >
          <UserIcon size={18} color="#9ca3af" />
        </Pressable>
      ),
    };
    return [...dataColumns, enrollmentColumn, replyCategoryColumn, replacementColumn, viewLeadColumn];
  }, [campaignId, insightSummary, router]);

  return (
    <>
      <View className="flex-row items-center justify-between mb-4 flex-wrap gap-2">
        <Text className="text-lg font-instrument-semibold text-white">Leads</Text>
        <View className="flex-row items-center justify-end gap-2 flex-wrap">
          {headerSummary ?? (
            <Text className="text-gray-400 font-instrument text-sm">
              {totalItems} {totalItems !== 1 ? 'items' : 'item'}
            </Text>
          )}
          {headerActions}
        </View>
      </View>
      <View className="mb-4">
        <View className="flex-row items-center min-h-10 bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl px-3 py-2">
          <MagnifyingGlassIcon size={18} color="#6b7280" />
          <TextInput
            value={searchQuery}
            onChangeText={onSearchChange}
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
        itemsPerPage={20}
        widthMode="equal-fill"
        emptyMessage="No leads found"
        onRowPress={
          selectionActive
            ? undefined
            : (row) => {
                setSelectedLead(row.__lead);
              }
        }
        getItemKey={(row) => row.__rowKey}
        paginationMode="server"
        currentPage={currentPage}
        totalItems={totalItems}
        onPageChange={onPageChange}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
        selectable={selectable && !!selectedKeys && !!onSelectionChange}
        selectedKeys={selectedKeys}
        onSelectionChange={onSelectionChange}
        onFetchViewKeys={onFetchViewKeys}
      />

      {selectedLead && (
        <LeadActivityModal
          visible={!!selectedLead}
          onClose={() => setSelectedLead(null)}
          leadId={selectedLead.id}
          campaignId={campaignId}
          leadEmail={selectedLead.email}
          leadName={selectedLead.name}
          replacementSummary={
            selectedLead.replacement_role
              ? {
                  replacementId: selectedLead.replacement_counterpart_lead_id ?? selectedLead.id,
                  role: selectedLead.replacement_role,
                  counterpartLeadId: selectedLead.replacement_counterpart_lead_id ?? '',
                  counterpartName: selectedLead.replacement_counterpart_name,
                  counterpartEmail: selectedLead.replacement_counterpart_email,
                  counterpartLabel: selectedLead.replacement_counterpart_label,
                  reason: selectedLead.replacement_reason ?? 'manual_referral',
                  reasonNote: selectedLead.replacement_reason_note,
                  completedAt: selectedLead.replacement_completed_at,
                  createdAt: selectedLead.replacement_completed_at ?? selectedLead.created_at,
                }
              : null
          }
        />
      )}
    </>
  );
}
