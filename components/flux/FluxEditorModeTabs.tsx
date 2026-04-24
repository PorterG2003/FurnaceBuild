import React from 'react';
import { Tabs, type Tab } from '@/components/ui/tabs';

export type FluxEditorPanelMode = 'manual' | 'chat';

interface FluxEditorModeTabsProps {
  mode: FluxEditorPanelMode;
  onModeChange: (mode: FluxEditorPanelMode) => void;
}

const MODE_TABS: Tab[] = [
  { id: 'manual', label: 'Manual' },
  { id: 'chat', label: 'Chat' },
];

export function FluxEditorModeTabs({ mode, onModeChange }: FluxEditorModeTabsProps) {
  return (
    <Tabs
      tabs={MODE_TABS}
      activeTab={mode}
      onTabChange={(id) => onModeChange(id as FluxEditorPanelMode)}
      layout="equal"
      marginBottom={16}
      color="indigo"
    />
  );
}
