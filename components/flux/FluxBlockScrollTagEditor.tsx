import React, { useMemo } from 'react';
import { View, Text, TextInput } from 'react-native';
import type { Block } from '@/lib/flux/types';
import { computeResolvedAnchorDomIdByBlockId } from '@/lib/flux/fluxScrollTag';
import { fluxPanelInputClass, fluxPanelLabelClass } from '@/lib/flux/fluxEditorPanelClasses';

const INPUT_CLASS = fluxPanelInputClass;

type FluxBlockScrollTagEditorProps = {
  block: Block;
  blocks: Block[];
  onSetScrollTag: (blockId: string, scrollTag: string | undefined) => void;
};

/** Manual editor fields for per-block landing page anchors (CTA URLs may use `#…` to scroll here). */
export function FluxBlockScrollTagEditor({ block, blocks, onSetScrollTag }: FluxBlockScrollTagEditorProps) {
  const resolvedId = useMemo(
    () => computeResolvedAnchorDomIdByBlockId(blocks).get(block.id) ?? null,
    [block.id, blocks],
  );
  const example = resolvedId ? `#${resolvedId}` : '#pricing';

  return (
    <View className="gap-1 mb-2">
      <Text className={fluxPanelLabelClass}>Section scroll tag (optional)</Text>
      <TextInput
        className={INPUT_CLASS}
        value={block.scrollTag ?? ''}
        onChangeText={(value) => onSetScrollTag(block.id, value.trim() ? value.trim() : undefined)}
        placeholder="e.g. pricing, results"
        placeholderTextColor="#555"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text className="text-gray-500 text-[10px] leading-4 font-instrument">
        In Hero / CTA / Tax calculator buttons, set the URL to{' '}
        <Text className="text-gray-400">{example}</Text>
        {resolvedId ? ' (this block’s id on the live page).' : ' (letters, numbers, dashes).'}
      </Text>
    </View>
  );
}
