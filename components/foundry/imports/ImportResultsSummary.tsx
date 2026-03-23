import React from 'react';
import { View, Text } from 'react-native';
import { Card } from '@/components/ui/Card';
import type { IngestionRunStats } from '@/lib/foundry/registry-types';

function num(s: IngestionRunStats | undefined, k: keyof IngestionRunStats): string {
  const v = s?.[k];
  return v != null ? String(v) : '—';
}

export function ImportResultsSummary({
  status,
  stats,
}: {
  status: string;
  stats: IngestionRunStats | undefined;
}) {
  return (
    <View className="flex-row flex-wrap gap-3">
      <Card variant="card" className="flex-1 min-w-[140px]">
        <Text className="text-xs text-gray-500 uppercase tracking-wider">Status</Text>
        <Text className="text-lg text-white font-instrument-semibold mt-1">{status}</Text>
      </Card>
      <Card variant="card" className="flex-1 min-w-[140px]">
        <Text className="text-xs text-gray-500 uppercase tracking-wider">Total rows</Text>
        <Text className="text-lg text-white font-instrument-semibold mt-1">{num(stats, 'total_rows')}</Text>
      </Card>
      <Card variant="card" className="flex-1 min-w-[140px]">
        <Text className="text-xs text-gray-500 uppercase tracking-wider">Imported</Text>
        <Text className="text-lg text-emerald-400 font-instrument-semibold mt-1">
          {num(stats, 'imported_rows')}
        </Text>
      </Card>
      <Card variant="card" className="flex-1 min-w-[140px]">
        <Text className="text-xs text-gray-500 uppercase tracking-wider">Warnings (file)</Text>
        <Text className="text-lg text-amber-400 font-instrument-semibold mt-1">
          {num(stats, 'warning_rows')}
        </Text>
      </Card>
      <Card variant="card" className="flex-1 min-w-[140px]">
        <Text className="text-xs text-gray-500 uppercase tracking-wider">Failed / skipped</Text>
        <Text className="text-lg text-red-400 font-instrument-semibold mt-1">
          {stats?.failed_rows != null || stats?.skipped_rows != null
            ? String((stats.failed_rows ?? 0) + (stats.skipped_rows ?? 0))
            : '—'}
        </Text>
      </Card>
    </View>
  );
}
