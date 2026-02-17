import { useState, useMemo } from 'react';
import { View, Text, TextInput } from 'react-native';
import { MagnifyingGlassIcon } from 'react-native-heroicons/outline';
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
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return leads;
    const q = searchQuery.toLowerCase();
    return leads.filter(
      (lead) =>
        lead.email.toLowerCase().includes(q) || (lead.name || '').toLowerCase().includes(q)
    );
  }, [leads, searchQuery]);

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
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-lg font-instrument-semibold text-white">Leads</Text>
        <Text className="text-gray-400 font-instrument text-sm">
          {filteredLeads.length} {filteredLeads.length !== 1 ? 'items' : 'item'}
          {searchQuery.trim() && ` (filtered from ${leads.length} total)`}
        </Text>
      </View>
      <View className="mb-4">
        <View className="flex-row items-center bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2">
          <MagnifyingGlassIcon size={18} color="#6b7280" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by email or name..."
            placeholderTextColor="#6b7280"
            className="flex-1 ml-2 text-white font-instrument text-sm"
          />
        </View>
      </View>
      <DataTable
        items={filteredLeads}
        columns={columns}
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

