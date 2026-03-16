import { Text, TextInput, View } from 'react-native';
import { MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/DataTable';
import type { SmartleadCampaign } from '@/lib/smartlead/migration';
import type { CampaignRow } from '../types';
import { CampaignSelectionSkeleton } from './Skeletons';
import { campaignSelectionColumns } from './tableColumns';

interface CampaignSelectionStepProps {
  showSkeleton: boolean;
  loading: boolean;
  error: string | null;
  campaigns: SmartleadCampaign[];
  selectedIds: Set<number>;
  campaignSearchQuery: string;
  filteredCampaignRows: CampaignRow[];
  campaignSelectedKeys: Set<string>;
  onToggleAll: () => void;
  onSearchChange: (value: string) => void;
  onSelectionChange: (keys: Set<string>) => void;
}

export function CampaignSelectionStep({
  showSkeleton,
  loading,
  error,
  campaigns,
  selectedIds,
  campaignSearchQuery,
  filteredCampaignRows,
  campaignSelectedKeys,
  onToggleAll,
  onSearchChange,
  onSelectionChange,
}: CampaignSelectionStepProps) {
  return (
    <View style={{ flex: 1 }}>
      {showSkeleton && <CampaignSelectionSkeleton />}

      {error && !loading && (
        <View className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <Text className="text-red-400 text-sm font-instrument">{error}</Text>
        </View>
      )}

      {!loading && !error && campaigns.length === 0 && (
        <View className="items-center py-12">
          <Text className="text-gray-400 text-sm font-instrument">
            No campaigns found in your Smartlead account.
          </Text>
        </View>
      )}

      {!loading && !error && campaigns.length > 0 && (
        <View style={{ flex: 1 }}>
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs text-gray-400 font-instrument-medium">
              Campaigns ({campaigns.length}) — sub-campaigns nested under parents
            </Text>
            <Button variant="link" onPress={onToggleAll} className="self-start">
              {selectedIds.size === campaigns.length ? 'Deselect All' : 'Select All'}
            </Button>
          </View>

          <View className="flex-row items-center rounded-lg border border-[#2A2A2A] bg-[#121212] px-3 py-2 mb-3">
            <MagnifyingGlassIcon size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
            <TextInput
              value={campaignSearchQuery}
              onChangeText={onSearchChange}
              placeholder="Search campaigns by name or status..."
              placeholderTextColor="#9CA3AF"
              className="flex-1 text-sm text-white font-instrument"
              style={{ paddingVertical: 4 }}
            />
          </View>

          <View style={{ flex: 1, minHeight: 280 }}>
            <DataTable<CampaignRow>
              items={filteredCampaignRows}
              getItemKey={(row) => String(row.campaign.id)}
              columns={campaignSelectionColumns}
              selectable
              selectedKeys={campaignSelectedKeys}
              onSelectionChange={onSelectionChange}
              pagination
              itemsPerPage={25}
              compactHeader
              emptyMessage={campaignSearchQuery.trim() ? 'No campaigns match your search' : 'No campaigns'}
            />
          </View>
        </View>
      )}
    </View>
  );
}
