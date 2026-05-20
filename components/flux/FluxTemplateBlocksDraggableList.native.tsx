import React, { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import {
  NestableDraggableFlatList,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { FluxBlockScrollTagEditor } from '@/components/flux/FluxBlockScrollTagEditor';
import {
  sortBlocksByOrder,
  type FluxTemplateBlocksDraggableListProps,
} from '@/components/flux/fluxTemplateBlocksDraggableListShared';

export type { FluxTemplateBlocksDraggableListProps } from '@/components/flux/fluxTemplateBlocksDraggableListShared';

export function FluxTemplateBlocksDraggableList({
  blocks,
  blockTypeLabels,
  blockSummary,
  editingBlockId,
  onToggleEditing,
  onRemove,
  onReorder,
  updateBlockProps,
  updateBlockScrollTag,
  contentAssets,
  renderBlockEditor,
  allowRemoveBlocks = true,
  pairFieldColumns = false,
  blockStylePreset,
}: FluxTemplateBlocksDraggableListProps) {
  const data = useMemo(() => sortBlocksByOrder(blocks), [blocks]);

  return (
    <NestableDraggableFlatList
      data={data}
      keyExtractor={(item) => item.id}
      scrollEnabled={false}
      onDragEnd={({ data: next }) => {
        onReorder(next.map((b, i) => ({ ...b, order: i })));
      }}
      containerStyle={{ paddingBottom: 4 }}
      renderItem={({ item: block, drag }) => {
        const selected = editingBlockId === block.id;
        return (
          <ScaleDecorator activeScale={1.02}>
            <View className="mb-1.5">
              <View
                className={`rounded-lg overflow-hidden border ${
                  selected ? 'border-indigo-500 bg-indigo-500/10' : 'border-[#2A2A2A] bg-[#1A1A1A]'
                }`}
              >
                <View className="flex-row items-stretch min-h-[44px]">
                  <Pressable
                    accessibilityLabel="Drag to reorder blocks"
                    onLongPress={drag}
                    delayLongPress={200}
                    className="px-2 justify-center bg-[#222] border-r border-[#2A2A2A] active:bg-[#2a2a2a] min-w-[44px] min-h-[44px]"
                  >
                    <Text className="text-gray-500 text-xs font-instrument" style={{ letterSpacing: -2 }}>
                      ⋮⋮
                    </Text>
                  </Pressable>
                  <Pressable
                    className="flex-1 px-2.5 py-2 justify-center min-w-0"
                    onPress={() => onToggleEditing(block.id)}
                  >
                    <Text className="text-white text-xs font-instrument-semibold" numberOfLines={1}>
                      {blockTypeLabels[block.type]}
                    </Text>
                    <Text className="text-gray-400 text-[11px] font-instrument" numberOfLines={1}>
                      {blockSummary(block)}
                    </Text>
                  </Pressable>
                  {allowRemoveBlocks ? (
                    <Pressable
                      className="px-2 min-w-[44px] min-h-[44px] justify-center items-center"
                      onPress={() => onRemove(block.id)}
                      accessibilityLabel="Remove block"
                    >
                      <Text className="text-red-400 text-sm">✕</Text>
                    </Pressable>
                  ) : null}
                </View>
                {selected ? (
                  <View className="border-t border-[#2A2A2A] px-3 py-2.5 bg-[#1A1A1A]">
                    <FluxBlockScrollTagEditor
                      block={block}
                      blocks={data}
                      onSetScrollTag={updateBlockScrollTag}
                    />
                    {renderBlockEditor(block, updateBlockProps, contentAssets, {
                      pairFieldColumns,
                      blockStylePreset,
                    })}
                  </View>
                ) : null}
              </View>
            </View>
          </ScaleDecorator>
        );
      }}
    />
  );
}
