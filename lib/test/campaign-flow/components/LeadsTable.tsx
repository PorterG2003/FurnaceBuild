import { useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { ChevronUpIcon, ChevronDownIcon, MagnifyingGlassIcon } from 'react-native-heroicons/outline';
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

type SortField = 'email' | 'name' | 'state' | 'created_at';
type SortDirection = 'asc' | 'desc';

export function LeadsTable({ leads, loading, campaignId }: LeadsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const itemsPerPage = 20;

  // Filter leads based on search query
  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return leads;

    const query = searchQuery.toLowerCase();
    return leads.filter((lead) => {
      return (
        lead.email.toLowerCase().includes(query) ||
        (lead.name && lead.name.toLowerCase().includes(query))
      );
    });
  }, [leads, searchQuery]);

  // Sort leads
  const sortedLeads = useMemo(() => {
    const sorted = [...filteredLeads].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortField) {
        case 'email':
          aValue = a.email.toLowerCase();
          bValue = b.email.toLowerCase();
          break;
        case 'name':
          aValue = (a.name || '').toLowerCase();
          bValue = (b.name || '').toLowerCase();
          break;
        case 'state':
          aValue = a.enrollment_state || '';
          bValue = b.enrollment_state || '';
          break;
        case 'created_at':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [filteredLeads, sortField, sortDirection]);

  // Paginate leads
  const totalPages = Math.ceil(sortedLeads.length / itemsPerPage);
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedLeads.slice(start, start + itemsPerPage);
  }, [sortedLeads, currentPage]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1); // Reset to first page on sort
  };

  const SortButton = ({ field, label }: { field: SortField; label: string }) => {
    const isActive = sortField === field;
    return (
      <Pressable
        onPress={() => handleSort(field)}
        className="flex-row items-center gap-1 px-3 py-2 active:opacity-70"
      >
        <Text
          className={`text-xs font-instrument-semibold ${
            isActive ? 'text-white' : 'text-gray-400'
          }`}
        >
          {label}
        </Text>
        {isActive && (
          <>
            {sortDirection === 'asc' ? (
              <ChevronUpIcon size={14} color="#fff" />
            ) : (
              <ChevronDownIcon size={14} color="#fff" />
            )}
          </>
        )}
      </Pressable>
    );
  };

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

  if (loading) {
    return (
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
        <Text className="text-gray-400 font-instrument text-sm">Loading leads...</Text>
      </View>
    );
  }

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-lg font-instrument-semibold text-white">Leads</Text>
        <Text className="text-gray-400 font-instrument text-sm">
          {sortedLeads.length} lead{sortedLeads.length !== 1 ? 's' : ''}
          {searchQuery && ` (filtered from ${leads.length} total)`}
        </Text>
      </View>

      {/* Search */}
      <View className="mb-4">
        <View className="flex-row items-center bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2">
          <MagnifyingGlassIcon size={18} color="#6b7280" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by email or name..."
            placeholderTextColor="#6b7280"
            className="flex-1 ml-2 text-white font-instrument text-sm"
            style={{ outline: 'none' }}
          />
        </View>
      </View>

      {/* Table */}
      <View>
        {/* Table Header */}
        <View className="flex-row border-b border-[#2A2A2A] pb-3 mb-4">
          <View className="flex-1">
            <SortButton field="email" label="Email" />
          </View>
          <View className="flex-1">
            <SortButton field="name" label="Name" />
          </View>
          <View className="w-32 items-start">
            <SortButton field="state" label="Status" />
          </View>
          <View className="w-40">
            <SortButton field="created_at" label="Created" />
          </View>
        </View>

        {/* Table Rows */}
        {paginatedLeads.length === 0 ? (
          <View className="py-12 items-center">
            <Text className="text-gray-500 font-instrument text-sm">
              {searchQuery ? 'No leads found matching your search' : 'No leads found'}
            </Text>
          </View>
        ) : (
          <View className="gap-3">
            {paginatedLeads.map((lead) => (
              <Pressable
                key={lead.id}
                onPress={() => setSelectedLead(lead)}
                className="flex-row items-center bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-4 py-3 active:opacity-80 active:border-[#3A3A3A]"
              >
                <View className="flex-1 pr-4">
                  <Text className="text-white font-instrument text-sm" numberOfLines={1}>
                    {lead.email}
                  </Text>
                </View>
                <View className="flex-1 pr-4">
                  <Text className="text-gray-400 font-instrument text-sm" numberOfLines={1}>
                    {lead.name || '—'}
                  </Text>
                </View>
                <View className="w-32 pr-4 items-start">
                  {getStateBadge(lead.enrollment_state)}
                </View>
                <View className="w-40">
                  <Text className="text-gray-400 font-instrument text-xs">
                    {new Date(lead.created_at).toLocaleDateString()}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>

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

      {/* Pagination */}
      <View className="flex-row items-center justify-between mt-6 pt-4 border-t border-[#2A2A2A]">
        <Pressable
          onPress={() => setCurrentPage(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className={`px-4 py-2 rounded-lg border ${
            currentPage === 1
              ? 'border-[#2A2A2A] opacity-50'
              : 'border-[#3A3A3A] active:opacity-70'
          }`}
          style={{ backgroundColor: '#1A1A1A' }}
        >
          <Text
            className={`text-sm font-instrument-semibold ${
              currentPage === 1 ? 'text-gray-500' : 'text-white'
            }`}
          >
            Previous
          </Text>
        </Pressable>

        <Text className="text-gray-400 font-instrument text-sm">
          Page {currentPage} of {totalPages}
        </Text>

        <Pressable
          onPress={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className={`px-4 py-2 rounded-lg border ${
            currentPage === totalPages
              ? 'border-[#2A2A2A] opacity-50'
              : 'border-[#3A3A3A] active:opacity-70'
          }`}
          style={{ backgroundColor: '#1A1A1A' }}
        >
          <Text
            className={`text-sm font-instrument-semibold ${
              currentPage === totalPages ? 'text-gray-500' : 'text-white'
            }`}
          >
            Next
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

