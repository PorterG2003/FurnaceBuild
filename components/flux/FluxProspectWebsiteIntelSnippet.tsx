import React from 'react';
import { Text, View } from 'react-native';
import type { FluxWebsiteIntelSnapshot } from '@/lib/flux/types';

/** Compact read-only website intel block used in the Flux prospect editor panel. */
export function FluxProspectWebsiteIntelSnippet({ snapshot }: { snapshot: FluxWebsiteIntelSnapshot }) {
  return (
    <View className="mt-1.5 border border-[#2A2A2A] rounded-lg p-2 gap-0.5">
      <Text className="text-gray-500 text-[10px] uppercase tracking-wider font-instrument-semibold">
        Website intel (read-only)
      </Text>
      <Text className="text-gray-400 text-[11px] font-instrument">
        Domain: {snapshot.normalized_domain_key}
        {snapshot.hit ? ' · cached hit' : ''}
      </Text>
      {snapshot.extracted_profile?.business_summary ? (
        <Text className="text-gray-300 text-[11px] font-instrument mt-0.5" numberOfLines={4}>
          {snapshot.extracted_profile.business_summary}
        </Text>
      ) : null}
    </View>
  );
}
