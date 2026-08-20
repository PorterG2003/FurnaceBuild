import { Text, View } from 'react-native';
import type { AccountCopyStatRow } from '@/lib/supabase/services/campaigns/account-copy-stats-rpc-map';

export function CopyPieceDetails({ row }: { row: AccountCopyStatRow }) {
  return (
    <View className="bg-[#111111] px-3.5 py-3 gap-3">
      {row.wordings.length > 0 ? (
        <View>
          <Text className="text-[10px] uppercase tracking-wide text-gray-500 font-instrument-semibold mb-1.5">
            Exact wording{row.wordings.length === 1 ? '' : 's'}
          </Text>
          <View className="gap-1.5">
            {row.wordings.map((wording) => (
              <Text
                key={wording.piece_id}
                className="text-xs text-gray-300 font-instrument"
              >
                &ldquo;{wording.display_text || wording.raw_text}&rdquo;
              </Text>
            ))}
          </View>
        </View>
      ) : null}
      <View className="flex-row flex-wrap gap-x-8 gap-y-3">
        <View className="min-w-[180px] flex-1">
          <Text className="text-[10px] uppercase tracking-wide text-gray-500 font-instrument-semibold mb-1">
            Campaigns
          </Text>
          <Text className="text-xs text-gray-300 font-instrument">
            {row.campaign_names.join(', ') ||
              `${row.campaigns} campaign${row.campaigns === 1 ? '' : 's'}`}
          </Text>
        </View>
        <View className="min-w-[180px] flex-1">
          <Text className="text-[10px] uppercase tracking-wide text-gray-500 font-instrument-semibold mb-1">
            Sequence steps
          </Text>
          <Text className="text-xs text-gray-300 font-instrument">
            {row.node_labels.join(', ') ||
              `${row.distinct_nodes} step${row.distinct_nodes === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>
    </View>
  );
}
