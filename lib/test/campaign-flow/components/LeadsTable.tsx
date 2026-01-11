import { useState } from 'react';
import { View, Text } from 'react-native';
import { DataTable, type TableColumn } from './DataTable';
import { LeadActivityModal } from './LeadActivityModal';

export interface Lead {
  id: string;
  email: string;
  name: string | null;
  enrollment_state: 'active' | 'completed' | null;
  enrollment_current_node_id: string | null;
  created_at: string;
}

interface LeadsTableProps {
  leads: Lead[];
  loading?: boolean;
  campaignId: string;
}

export function LeadsTable({ leads, loading, campaignId }: LeadsTableProps) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const getStateBadge = (state: string | null) => {
    if (!state) {
      return (
        <View className="self-start px-3 py-1.5 rounded-md" style={{ backgroundColor: '#6b728020' }}>
          <Text className="text-xs font-instrument-semibold text-gray-500">Not Started</Text>
        </View>
      );
    }

    const colors =
      state === 'completed'
        ? { bg: '#10b98120', text: '#10b981' }
        : { bg: '#3b82f620', text: '#3b82f6' };

    return (
      <View className="self-start px-3 py-1.5 rounded-md" style={{ backgroundColor: colors.bg }}>
        <Text className="text-xs font-instrument-semibold" style={{ color: colors.text }}>
          {state === 'completed' ? 'Completed' : 'In Progress'}
        </Text>
      </View>
    );
  };

  const columns: TableColumn<Lead>[] = [
    {
      key: 'email',
      label: 'Email',
      minWidth: 200,
      flex: 1,
      sortable: true,
      sortValue: (lead) => lead.email.toLowerCase(),
      render: (lead) => (
        <Text className="text-white font-instrument text-sm" numberOfLines={1}>
          {lead.email}
        </Text>
      ),
    },
    {
      key: 'name',
      label: 'Name',
      minWidth: 150,
      flex: 1,
      sortable: true,
      sortValue: (lead) => (lead.name || '').toLowerCase(),
      render: (lead) => (
        <Text className="text-gray-400 font-instrument text-sm" numberOfLines={1}>
          {lead.name || '—'}
        </Text>
      ),
    },
    {
      key: 'state',
      label: 'Status',
      minWidth: 130,
      flex: 0,
      sortable: true,
      sortValue: (lead) => lead.enrollment_state || '',
      render: (lead) => getStateBadge(lead.enrollment_state),
    },
    {
      key: 'created_at',
      label: 'Created',
      minWidth: 160,
      flex: 0,
      sortable: true,
      sortValue: (lead) => new Date(lead.created_at).getTime(),
      render: (lead) => (
        <Text className="text-gray-400 font-instrument text-xs">
          {new Date(lead.created_at).toLocaleDateString()}
        </Text>
      ),
    },
  ];

  return (
    <>
      <DataTable
        title="Leads"
        items={leads}
        columns={columns}
        searchable={true}
        searchPlaceholder="Search by email or name..."
        searchFilter={(lead, query) => {
          const email = lead.email.toLowerCase();
          const name = (lead.name || '').toLowerCase();
          return email.includes(query) || name.includes(query);
        }}
        loading={loading}
        emptyMessage="No leads found"
        onRowPress={(lead) => setSelectedLead(lead)}
        getItemKey={(lead) => lead.id}
      />

      {/* Activity Modal */}
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

