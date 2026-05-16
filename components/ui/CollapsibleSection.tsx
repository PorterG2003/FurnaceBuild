import React from 'react';
import type { ComponentType } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'react-native-heroicons/outline';
import { Platform, Pressable, Text, View } from 'react-native';
import { cn } from '@/lib/cn';
import {
  fluxPanelEditorSectionBodyClass,
  fluxPanelEditorSectionHeaderClass,
  fluxPanelEditorSectionShellClass,
} from '@/lib/flux/fluxEditorPanelClasses';

type HeroOutlineIcon = ComponentType<{ size?: number; color?: string }>;

export function CollapsibleSection({
  title,
  icon: Icon,
  open,
  onToggle,
  compact = false,
  appearance = 'default',
  children,
}: {
  title: string;
  icon?: HeroOutlineIcon;
  open: boolean;
  onToggle: () => void;
  /** Tighter header and body spacing (Flux editor panel). */
  compact?: boolean;
  /** Card + header strip (Flux manual editor only; keeps default for export filters). */
  appearance?: 'default' | 'editorPanel';
  children: React.ReactNode;
}) {
  const iconSize = compact ? 12 : 14;
  const webSelect = Platform.OS === 'web' ? ({ userSelect: 'none' as const } as const) : {};

  const header = (
    <Pressable
      onPress={onToggle}
      className={cn(
        appearance === 'editorPanel' ? fluxPanelEditorSectionHeaderClass : undefined,
        appearance === 'editorPanel'
          ? compact
            ? 'px-2 py-1'
            : 'px-2.5 py-1.5'
          : `flex-row items-center justify-between ${compact ? 'py-1' : 'py-1.5'}`,
        appearance === 'default' && 'flex-row items-center justify-between',
      )}
      style={{
        minWidth: 0,
        ...webSelect,
      }}
    >
      <View className={`flex-row items-center min-w-0 ${compact ? 'gap-1.5' : 'gap-2'}`}>
        {Icon ? <Icon size={iconSize} color="#9ca3af" /> : null}
        <Text
          selectable={false}
          className={`text-gray-300 font-instrument-semibold uppercase tracking-wider ${
            compact ? 'text-[10px]' : 'text-xs'
          }`}
        >
          {title}
        </Text>
      </View>
      {open ? (
        <ChevronDownIcon size={iconSize} color="#9ca3af" />
      ) : (
        <ChevronRightIcon size={iconSize} color="#9ca3af" />
      )}
    </Pressable>
  );

  const body =
    open ? (
      <View
        className={cn(
          appearance === 'editorPanel' ? fluxPanelEditorSectionBodyClass : undefined,
          appearance === 'editorPanel'
            ? compact
              ? 'gap-1.5 px-2 py-2'
              : 'gap-2 px-2.5 py-2.5'
            : compact
              ? 'gap-1.5 pt-0.5'
              : 'gap-2 pt-1',
        )}
        style={{
          alignSelf: 'stretch',
          ...webSelect,
        }}
      >
        {children}
      </View>
    ) : null;

  if (appearance === 'editorPanel') {
    return (
      <View className={fluxPanelEditorSectionShellClass} style={{ alignSelf: 'stretch', ...webSelect }}>
        {header}
        {body}
      </View>
    );
  }

  return (
    <View
      className={`border-b border-[#252525] ${compact ? 'pb-1' : 'pb-2'}`}
      style={{
        alignSelf: 'stretch',
        ...webSelect,
      }}
    >
      {header}
      {body}
    </View>
  );
}
