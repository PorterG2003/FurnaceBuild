import { View, Text } from 'react-native';
import type { CompanyLocationRow } from '@/lib/foundry/registry-types';
import { dash, formatDetailTimestamp } from './companyDetailFormat';

function formatAddress(loc: CompanyLocationRow): string {
  const parts: string[] = [];
  if (loc.line1) parts.push(loc.line1);
  if (loc.line2) parts.push(loc.line2);
  const cityLine = [loc.city, loc.state_region, loc.postal_code].filter(Boolean).join(', ');
  if (cityLine) parts.push(cityLine);
  if (loc.country) parts.push(loc.country);
  if (parts.length > 0) return parts.join('\n');
  return '—';
}

export function CompanyLocationsPanel({ locations }: { locations: CompanyLocationRow[] }) {
  if (locations.length === 0) {
    return (
      <View className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-4">
        <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">Locations</Text>
        <Text className="text-gray-500 font-instrument text-sm">No locations.</Text>
      </View>
    );
  }

  return (
    <View className="mb-4">
      <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-2">Locations</Text>
      {locations.map((loc) => (
        <View
          key={loc.id}
          className={`p-4 rounded-lg border bg-[#1A1A1A] mb-2 ${
            loc.is_primary ? 'border-brand-orange/50 bg-[rgba(243,68,13,0.06)]' : 'border-[#2A2A2A]'
          }`}
        >
          <View className="flex-row flex-wrap items-center gap-2 mb-2">
            {loc.is_primary ? (
              <Text className="text-brand-orange font-instrument-semibold text-[10px] uppercase tracking-wider border border-brand-orange/40 px-2 py-0.5 rounded">
                Primary
              </Text>
            ) : null}
            <Text className="text-gray-500 font-mono text-[10px]">{loc.id}</Text>
          </View>
          <Text className="text-white font-instrument text-sm leading-6 whitespace-pre-line">{formatAddress(loc)}</Text>
          <View className="mt-3 gap-1">
            <Text className="text-gray-500 font-instrument text-xs">
              City: {dash(loc.city)} · State: {dash(loc.state_region)} · Postal: {dash(loc.postal_code)} · Country:{' '}
              {dash(loc.country)}
            </Text>
            <Text className="text-gray-600 font-instrument text-[10px]">
              Updated {formatDetailTimestamp(loc.updated_at)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
