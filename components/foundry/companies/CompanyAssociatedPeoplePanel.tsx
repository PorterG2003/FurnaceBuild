import { View, Text } from 'react-native';
import type { CompanyAssociatedPersonRow } from '@/lib/foundry/registry-types';
import { formatDetailTimestamp } from './companyDetailFormat';

function sortPeople(rows: CompanyAssociatedPersonRow[]): CompanyAssociatedPersonRow[] {
  return [...rows].sort((a, b) => {
    const sa = (a.registry_state || '').localeCompare(b.registry_state || '');
    if (sa !== 0) return sa;
    return a.owner_name.localeCompare(b.owner_name);
  });
}

export function CompanyAssociatedPeoplePanel({ people }: { people: CompanyAssociatedPersonRow[] }) {
  const sorted = sortPeople(people);

  if (sorted.length === 0) {
    return (
      <View className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-4">
        <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">
          People (registry)
        </Text>
        <Text className="text-gray-500 font-instrument text-sm">
          No current officers or owners on matched registry entities. Link the company to a state entity with parsed
          registry data to see people here.
        </Text>
      </View>
    );
  }

  return (
    <View className="mb-4">
      <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">
        People (registry)
      </Text>
      {sorted.map((row) => (
        <View key={row.id} className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-2">
          <View className="flex-row flex-wrap items-center gap-2 mb-1">
            <Text className="text-white font-instrument-semibold text-sm flex-1 min-w-[160px]">{row.owner_name}</Text>
            {row.registry_state ? (
              <Text className="text-white font-instrument-semibold text-xs border border-[#3A3A3A] px-2 py-0.5 rounded">
                {row.registry_state}
              </Text>
            ) : null}
          </View>
          {row.title_role ? (
            <Text className="text-gray-400 font-instrument text-sm mb-2">{row.title_role}</Text>
          ) : null}
          <View className="flex-row flex-wrap gap-x-4 gap-y-1">
            <Text className="text-gray-500 font-instrument text-xs">
              Observed {formatDetailTimestamp(row.observed_at)}
            </Text>
            {row.effective_at ? (
              <Text className="text-gray-500 font-instrument text-xs">
                Effective {formatDetailTimestamp(row.effective_at)}
              </Text>
            ) : null}
            {row.ended_at ? (
              <Text className="text-gray-500 font-instrument text-xs">
                Ended {formatDetailTimestamp(row.ended_at)}
              </Text>
            ) : null}
          </View>
          <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mt-2 mb-0.5">
            State entity
          </Text>
          <Text selectable className="text-gray-400 font-mono text-xs leading-5">
            {row.state_entity_id}
          </Text>
          {[row.first_name, row.last_name].filter(Boolean).length > 0 ? (
            <Text className="text-gray-600 font-instrument text-xs mt-1">
              Parsed: {[row.first_name, row.last_name].filter(Boolean).join(' ')}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
