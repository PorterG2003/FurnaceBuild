import { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable } from 'react-native';
import { BaseModal } from '@/components/ui/modals/BaseModal';
import { Button } from '@/components/ui/button';

export type DedupeMergeField = { key: string; label: string };

export function DedupeMergeModal({
  visible,
  onClose,
  title,
  columnLabels,
  fields,
  valueMatrix,
  onConfirm,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  columnLabels: string[];
  fields: DedupeMergeField[];
  /** valueMatrix[i][j] = field i, source column j */
  valueMatrix: string[][];
  onConfirm: (merged: Record<string, string>, survivorColumnIndex: number) => void;
  busy: boolean;
}) {
  const [survivorIdx, setSurvivorIdx] = useState(0);
  const [merged, setMerged] = useState<Record<string, string>>({});

  useEffect(() => {
    if (visible) setSurvivorIdx(0);
  }, [visible]);

  useEffect(() => {
    if (!visible || fields.length === 0) return;
    const next: Record<string, string> = {};
    for (let fi = 0; fi < fields.length; fi++) {
      const k = fields[fi]!.key;
      next[k] = valueMatrix[fi]?.[survivorIdx] ?? '';
    }
    setMerged(next);
  }, [visible, survivorIdx, fields, valueMatrix]);

  const footer = (
    <View className="flex-row flex-wrap gap-2 justify-end">
      <Button variant="secondary" onPress={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button
        variant="default"
        disabled={busy}
        onPress={() => onConfirm(merged, survivorIdx)}
      >
        Apply merge
      </Button>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title={title}
      description="Pick the survivor column for defaults, then edit the merged values. Rows are fields; columns are selected records plus merged output."
      maxWidth="4xl"
      footer={footer}
    >
      <View className="mb-3">
        <Text className="text-gray-500 font-instrument text-xs uppercase tracking-wider mb-2">Survivor defaults</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
          {columnLabels.map((label, i) => (
            <Pressable
              key={`surv-${i}`}
              onPress={() => setSurvivorIdx(i)}
              className={`mr-2 mb-2 py-2 px-3 rounded-lg border ${
                survivorIdx === i ? 'border-brand-orange bg-[rgba(243,68,13,0.12)]' : 'border-[#3A3A3A] bg-[#2A2A2A]'
              }`}
            >
              <Text className="text-white font-instrument text-xs" numberOfLines={2}>
                {label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator className="max-h-[60vh]">
        <View>
          <View className="flex-row border-b border-[#2A2A2A] pb-2 mb-2">
            <View className="w-28 pr-2">
              <Text className="text-gray-500 font-instrument-semibold text-xs">Field</Text>
            </View>
            {columnLabels.map((label, ci) => (
              <View key={`h-${ci}`} className="w-40 px-1">
                <Text className="text-gray-400 font-instrument-semibold text-xs" numberOfLines={3}>
                  {label}
                </Text>
              </View>
            ))}
            <View className="w-44 pl-1">
              <Text className="text-brand-orange font-instrument-semibold text-xs">Merged</Text>
            </View>
          </View>
          {fields.map((f, fi) => (
            <View key={f.key} className="flex-row py-2 border-b border-[#1A1A1A] items-start">
              <View className="w-28 pr-2">
                <Text className="text-gray-500 font-instrument text-xs">{f.label}</Text>
              </View>
              {columnLabels.map((_, ci) => (
                <View key={`${f.key}-${ci}`} className="w-40 px-1">
                  <Text className="text-gray-300 font-instrument text-xs leading-5" selectable>
                    {valueMatrix[fi]?.[ci] ?? '—'}
                  </Text>
                </View>
              ))}
              <View className="w-44 pl-1">
                <TextInput
                  value={merged[f.key] ?? ''}
                  onChangeText={(t) => setMerged((m) => ({ ...m, [f.key]: t }))}
                  multiline
                  className="text-white font-instrument text-xs border border-[#3A3A3A] rounded-md px-2 py-1.5 bg-[#0D0D0D] min-h-[36px]"
                  placeholderTextColor="#666"
                  editable={!busy}
                />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </BaseModal>
  );
}
