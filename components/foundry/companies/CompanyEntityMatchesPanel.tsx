import { View, Text } from 'react-native';
import type { CompanyEntityMatchRow } from '@/lib/foundry/registry-types';
import { formatEntityMatchScore, statusBadgeClass } from './companyDetailFormat';

export function CompanyEntityMatchesPanel({ matches }: { matches: CompanyEntityMatchRow[] }) {
  if (matches.length === 0) {
    return (
      <View className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-4">
        <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">State registry</Text>
        <Text className="text-gray-500 font-instrument text-sm">No entity matches.</Text>
      </View>
    );
  }

  return (
    <View className="mb-4">
      <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">State registry</Text>
      {matches.map((row) => {
        const badge = statusBadgeClass(row.match_status);
        return (
          <View key={row.id} className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-2">
            <View className="flex-row flex-wrap items-center gap-2 mb-2">
              <Text className="text-white font-instrument-semibold text-sm border border-[#3A3A3A] px-2 py-0.5 rounded">
                {row.registry_state || '—'}
              </Text>
              <Text
                className={`font-instrument-semibold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${badge}`}
              >
                {row.match_status || '—'}
              </Text>
              <Text className="text-gray-400 font-instrument text-xs">Match {formatEntityMatchScore(row)}</Text>
              {row.is_current ? (
                <Text className="text-emerald-400/80 font-instrument text-[10px]">Current</Text>
              ) : (
                <Text className="text-gray-600 font-instrument text-[10px]">Not current</Text>
              )}
            </View>
            <Text className="text-gray-500 font-instrument text-xs mb-1">State entity ID</Text>
            <Text selectable className="text-gray-300 font-mono text-xs leading-5">
              {row.state_entity_id}
            </Text>
            <Text className="text-gray-600 font-mono text-[10px] mt-2">Match row {row.id}</Text>
          </View>
        );
      })}
    </View>
  );
}
