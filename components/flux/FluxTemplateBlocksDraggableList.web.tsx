import React, { useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { View, Text, Pressable } from 'react-native';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
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

  const onDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      const { source, destination } = result;
      if (source.index === destination.index) return;
      const next = [...data];
      const [removed] = next.splice(source.index, 1);
      next.splice(destination.index, 0, removed);
      onReorder(next.map((b, i) => ({ ...b, order: i })));
    },
    [data, onReorder],
  );

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="flux-template-blocks">
        {(dropProvided) => (
          <div
            ref={dropProvided.innerRef}
            {...dropProvided.droppableProps}
            style={{ paddingBottom: 4 }}
          >
            {data.map((block, index) => (
              <Draggable key={block.id} draggableId={block.id} index={index}>
                {(dragProvided, snapshot) => {
                  const { style: dragStyle, ...dragRest } = dragProvided.draggableProps;
                  const draggableNode = (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragRest}
                      style={{
                        ...dragStyle,
                        marginBottom: 8,
                        opacity: snapshot.isDragging ? 0.92 : 1,
                      }}
                    >
                      <View
                        className={`rounded-xl overflow-hidden border ${
                          editingBlockId === block.id
                            ? 'border-indigo-500 bg-indigo-500/10'
                            : 'border-[#2A2A2A] bg-[#1A1A1A]'
                        }`}
                      >
                        <View className="flex-row items-stretch min-h-[52px]">
                          <div
                            {...dragProvided.dragHandleProps}
                            className="px-2.5 justify-center bg-[#222] border-r border-[#2A2A2A] cursor-grab active:cursor-grabbing min-w-[44px] min-h-[44px] flex items-center"
                            aria-label="Drag to reorder blocks"
                            style={{ touchAction: 'none' }}
                          >
                            <Text className="text-gray-500 text-sm font-instrument" style={{ letterSpacing: -2 }}>
                              ⋮⋮
                            </Text>
                          </div>
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
                              className="px-3 min-w-[44px] min-h-[44px] justify-center items-center"
                              onPress={() => onRemove(block.id)}
                              accessibilityLabel="Remove block"
                            >
                              <Text className="text-red-400 text-base">✕</Text>
                            </Pressable>
                          ) : null}
                        </View>
                        {editingBlockId === block.id ? (
                          <View className="border-t border-[#2A2A2A] px-4 py-4 bg-[#1A1A1A]">
                            {renderBlockEditor(block, updateBlockProps, contentAssets)}
                          </View>
                        ) : null}
                      </View>
                    </div>
                  );

                  if (snapshot.isDragging && typeof document !== 'undefined') {
                    return createPortal(draggableNode, document.body);
                  }

                  return draggableNode;
                }}
              </Draggable>
            ))}
            {dropProvided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
