import React, { useState } from 'react';
import { View, ScrollView, useWindowDimensions, Platform } from 'react-native';
import { EditorColumnScrollView } from '@/components/flux/EditorColumnScrollView';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { Tabs, type Tab } from '@/components/ui/tabs';

export type FluxEditorSplitTab = 'editor' | 'preview';
export type FluxEditorSplitVariant = 'ideation' | 'studio';

interface FluxEditorSplitLayoutProps {
  variant?: FluxEditorSplitVariant;
  /** Renders above the split (full width). */
  header?: React.ReactNode;
  /** Main editor body (wrapped in a column ScrollView on wide; same on narrow Editor tab). */
  editor: React.ReactNode;
  /** Optional label for the editor tab on narrow layouts. */
  editorLabel?: string;
  /** When false, editor renders in a fixed-height column and manages its own internal scroll. */
  editorScrollable?: boolean;
  /** Live preview (wrapped in a column ScrollView on wide; Preview tab on narrow). */
  preview: React.ReactNode;
  /** Optional dimmed layer on top of the preview column (e.g. “Rerender with AI”). */
  previewOverlay?: React.ReactNode;
  /**
   * When true, editor column uses NestableScrollContainer so a nested NestableDraggableFlatList
   * can share vertical scroll with the rest of the editor (e.g. Flux campaign block list).
   */
  editorNestableScroll?: boolean;
}

export function FluxEditorSplitLayout({
  variant = 'studio',
  header,
  editor,
  editorLabel = 'Chat',
  editorScrollable = true,
  preview,
  previewOverlay,
  editorNestableScroll = false,
}: FluxEditorSplitLayoutProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= LAYOUT_BREAKPOINT;
  const [narrowTab, setNarrowTab] = useState<FluxEditorSplitTab>('editor');
  const isIdeation = variant === 'ideation';
  const keyboardTapBehavior = Platform.OS === 'web' ? 'always' : 'handled';

  const editorContentPadding = isWide ? 6 : 0;

  const tabBar = !isWide && !isIdeation ? (
    <Tabs
      tabs={[
        { id: 'editor', label: editorLabel },
        { id: 'preview', label: 'Preview' },
      ]}
      activeTab={narrowTab}
      onTabChange={(id) => setNarrowTab(id as FluxEditorSplitTab)}
      layout="equal"
      marginBottom={6}
      textSize={12}
      compact
      color="indigo"
    />
  ) : null;

  const editorScrollContentStyle = {
    padding: editorContentPadding,
    paddingBottom: isWide ? 14 : 12,
    flexGrow: 1,
  };

  const editorScroll = (
    <EditorColumnScrollView
      nestable={!!editorNestableScroll}
      className="flex-1"
      style={{ flex: 1 }}
      contentContainerStyle={editorScrollContentStyle}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      keyboardShouldPersistTaps={keyboardTapBehavior}
    >
      {editor}
    </EditorColumnScrollView>
  );

  const editorPane = editorScrollable ? (
    editorScroll
  ) : (
    <View className="flex-1" style={{ minHeight: 0, padding: editorContentPadding }}>
      {editor}
    </View>
  );

  const previewPane = (
    <View className="flex-1 bg-[#0d0d0d]" style={{ position: 'relative', minHeight: 0 }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        {preview}
      </ScrollView>
      {previewOverlay ? (
        <View
          className="absolute inset-0 justify-center items-center px-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          pointerEvents="box-none"
        >
          {previewOverlay}
        </View>
      ) : null}
    </View>
  );

  if (isWide) {
    return (
      <View className="flex-1">
        {header}
        {isIdeation ? (
          <View className="flex-1" style={{ minHeight: 0 }}>
            {editorPane}
          </View>
        ) : (
          <View className="flex-1 flex-row" style={{ minHeight: 0 }}>
            <View className="min-w-0 flex-1" style={{ minHeight: 0 }}>
              {previewPane}
            </View>
            <View
              className="border-l border-[#2A2A2A] overflow-hidden"
              style={{
                flexBasis: 380,
                flexGrow: 0,
                flexShrink: 1,
                minWidth: 288,
                maxWidth: 400,
                minHeight: 0,
              }}
            >
              {editorPane}
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1">
      {header}
      <View className="flex-1 px-2.5 pt-1" style={{ minHeight: 0 }}>
        {tabBar}
        {isIdeation || narrowTab === 'editor' ? editorPane : previewPane}
      </View>
    </View>
  );
}
