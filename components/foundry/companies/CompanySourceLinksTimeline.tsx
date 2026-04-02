import { useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { Link } from 'expo-router';
import type { CompanySourceLinkRow } from '@/lib/foundry/registry-types';
import {
  formatDetailTimestamp,
  formatLinkScoreDisplay,
  normalizeWebsiteHref,
  sourceLinkSortKey,
  statusBadgeClass,
} from './companyDetailFormat';

export function CompanySourceLinksTimeline({
  links,
  defaultExpanded = false,
}: {
  links: CompanySourceLinkRow[];
  /** When false, provenance starts collapsed. */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const sorted = [...links].sort((a, b) => sourceLinkSortKey(a) - sourceLinkSortKey(b));
  const countLabel = sorted.length === 0 ? 'No source links' : `${sorted.length} source link${sorted.length === 1 ? '' : 's'}`;

  return (
    <View className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] mb-4">
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        className="flex-row items-center justify-between gap-3 py-0.5"
      >
        <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider">Provenance</Text>
        <View className="flex-row items-center gap-2 shrink">
          <Text className="text-gray-500 font-instrument text-xs" numberOfLines={1}>
            {countLabel}
          </Text>
          <Text className="text-gray-500 font-instrument text-xs w-4 text-right">{expanded ? '▼' : '▶'}</Text>
        </View>
      </Pressable>

      {expanded ? (
        sorted.length === 0 ? (
          <Text className="text-gray-500 font-instrument text-sm mt-3">No source links.</Text>
        ) : (
          <View className="pl-2 mt-3">
            {sorted.map((row, index) => {
              const isLast = index === sorted.length - 1;
              const badge = statusBadgeClass(row.link_status);
              const href = row.website ? normalizeWebsiteHref(row.website) : '';
              return (
                <View key={row.id} className="flex-row">
                  <View className="items-center mr-3 w-3">
                    <View className="w-2.5 h-2.5 rounded-full bg-brand-orange/80 mt-1" />
                    {!isLast ? <View className="w-px h-10 bg-[#3A3A3A] my-0.5" /> : null}
                  </View>
                  <View className={`flex-1 pb-5 ${isLast ? 'pb-0' : ''}`}>
                    <View className="flex-row flex-wrap items-center gap-2 mb-1">
                      <Text
                        className={`font-instrument-semibold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${badge}`}
                      >
                        {row.link_status || '—'}
                      </Text>
                      <Text className="text-gray-400 font-instrument text-xs">
                        Score {formatLinkScoreDisplay(row.link_score)}
                      </Text>
                      {row.is_current ? (
                        <Text className="text-emerald-400/80 font-instrument text-[10px]">Current</Text>
                      ) : (
                        <Text className="text-gray-600 font-instrument text-[10px]">Not current</Text>
                      )}
                    </View>
                    <Text className="text-gray-500 font-instrument text-xs mb-2">{formatDetailTimestamp(row.created_at)}</Text>
                    {row.website ? (
                      <Pressable
                        onPress={() => href && void Linking.openURL(href)}
                        className="self-start mb-1"
                      >
                        <Text className="text-brand-orange font-instrument text-sm underline" numberOfLines={2}>
                          {row.website}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Text className="text-gray-600 font-mono text-[10px] mb-2">{row.source_business_record_id}</Text>
                    <Link href={`/foundry/source-records/${row.source_business_record_id}`} asChild>
                      <Pressable className="self-start">
                        <Text className="text-brand-orange font-instrument text-sm underline">Open source record</Text>
                      </Pressable>
                    </Link>
                  </View>
                </View>
              );
            })}
          </View>
        )
      ) : null}
    </View>
  );
}
