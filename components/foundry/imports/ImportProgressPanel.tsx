import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';

const STEPS = ['Create ingestion run', 'Parse CSV', 'Validate rows', 'Insert records', 'Finalize stats'] as const;

export function ImportProgressPanel({ busy }: { busy: boolean }) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      setStepIndex((i) => (i + 1) % STEPS.length);
    }, 900);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (!busy) setStepIndex(0);
  }, [busy]);

  return (
    <View className="gap-4 items-center py-8">
      <ActivityIndicator size="large" color="#f3440d" />
      <Text className="text-white font-instrument-medium text-base">Import in progress</Text>
      <Text className="text-gray-400 font-instrument text-sm text-center px-4">
        {busy ? STEPS[stepIndex] : 'Done'}
      </Text>
      <View className="w-full max-w-md h-2 bg-[#2A2A2A] rounded-full overflow-hidden">
        <View
          className="h-full bg-brand-orange rounded-full"
          style={{ width: busy ? '88%' : '100%', opacity: busy ? 0.5 : 1 }}
        />
      </View>
      <Text className="text-gray-500 font-instrument text-xs text-center">
        Large files may take up to a minute. Do not close this tab.
      </Text>
    </View>
  );
}
