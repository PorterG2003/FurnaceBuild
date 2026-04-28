import React, { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import {
  NestableDraggableFlatList,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
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
  contentAssets,
  renderBlockEditor,
  allowRemoveBlocks = true,
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
            <View className="mb-2">
              <View
                className={`rounded-xl overflow-hidden border ${
                  selected ? 'border-indigo-500 bg-indigo-500/10' : 'border-[#2A2A2A] bg-[#1A1A1A]'
                }`}
              >
                <View className="flex-row items-stretch min-h-[52px]">
                  <Pressable
                    accessibilityLabel="Drag to reorder blocks"
                    onLongPress={drag}
                    delayLongPress={200}
                    className="px-2.5 justify-center bg-[#222] border-r border-[#2A2A2A] active:bg-[#2a2a2a]"
                  >
                    <Text className="text-gray-500 text-sm font-instrument" style={{ letterSpacing: -2 }}>
                      ⋮⋮
                    </Text>
                  </Pressable>
                  <Pressable
                    className="flex-1 px-3 py-3 justify-center"
                    onPress={() => onToggleEditing(block.id)}
                  >
                    <Text className="text-white text-sm font-instrument-semibold">
                      {blockTypeLabels[block.type]}
                    </Text>
                    <Text className="text-gray-400 text-xs font-instrument" numberOfLines={1}>
                      {blockSummary(block)}
                    </Text>
                  </Pressable>
                  {allowRemoveBlocks ? (
                    <Pressable
                      className="px-3 justify-center"
                      onPress={() => onRemove(block.id)}
                      accessibilityLabel="Remove block"
                    >
                      <Text className="text-red-400 text-base">✕</Text>
                    </Pressable>
                  ) : null}
                </View>
                {selected ? (
                  <View className="border-t border-[#2A2A2A] px-4 py-4 bg-[#1A1A1A]">
                    {renderBlockEditor(block, updateBlockProps, contentAssets)}
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
