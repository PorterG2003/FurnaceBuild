import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import type { FluxCampaignQaStatus } from '@/lib/flux/fluxCampaignMethodologyQa';

interface FluxCampaignQaPanelProps {
  status: FluxCampaignQaStatus;
  onOpenAdvanced?: () => void;
}

export function FluxCampaignQaPanel({ status, onOpenAdvanced }: FluxCampaignQaPanelProps) {
  const summary = useMemo(() => {
    const total = status.structural.length;
    const passed = status.structuralPassedCount;
    return `${passed}/${total} complete`;
  }, [status]);

  return (
    <View className="gap-4">
      <View
        className={`rounded-2xl border px-4 py-4 ${
          status.isComplete
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-amber-500/20 bg-amber-500/8'
        }`}
      >
        <Text className="text-white text-sm font-instrument-semibold">Campaign readiness</Text>
        <Text className="text-gray-300 text-xs font-instrument leading-5 mt-1">
          {status.isComplete
            ? `All structural checks are passing. ${summary}.`
            : `A few campaign checks are still open. ${summary}.`}
        </Text>
        {!status.isComplete ? (
          <Text className="text-amber-100/90 text-xs font-instrument leading-5 mt-2">
            Flux derives these checks from the spec, blocks, proof path, and current AI preview so readiness stays automatic.
          </Text>
        ) : null}
      </View>

      <View>
        <Text className="text-gray-500 text-[11px] uppercase tracking-wider font-instrument-semibold mb-2">
          Structural checks
        </Text>
        <View className="gap-2">
          {status.structural.map((row) => (
            <View
              key={row.id}
              className={`rounded-xl border px-3 py-3 ${
                row.passed ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-[#2F2F2F] bg-[#191919]'
              }`}
            >
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-white text-sm font-instrument-semibold">{row.label}</Text>
                  <Text className="text-gray-400 text-xs font-instrument leading-5 mt-1">
                    {row.description}
                  </Text>
                </View>
                <Text
                  className={`text-[10px] font-instrument-semibold uppercase ${
                    row.passed ? 'text-emerald-200' : 'text-gray-500'
                  }`}
                >
                  {row.passed ? 'Pass' : 'Open'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {onOpenAdvanced ? (
        <View className="items-start">
          <Button size="xs" variant="link" onPress={onOpenAdvanced}>
            Open advanced editor
          </Button>
        </View>
      ) : null}
    </View>
  );
}
