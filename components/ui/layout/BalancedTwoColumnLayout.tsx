import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { debounce } from '@/lib/utils/debounce';
import { computeTwoColumnAssignment } from './columnPacking';
import { MeasuredSection } from './MeasuredSection';

const DEFAULT_CONTENT_MAX_WIDTH = 960;
const DEFAULT_COLUMN_MAX_WIDTH = 440;
const HEIGHT_DEBOUNCE_MS = 120;

export interface BalancedSection {
  id: string;
  groupLabel?: string;
  content: React.ReactNode;
}

interface BalancedTwoColumnLayoutProps {
  sections: BalancedSection[];
  isDesktop?: boolean;
  contentMaxWidth?: number;
  columnMaxWidth?: number;
  /** When true, use tighter vertical spacing (e.g. for mobile). */
  compact?: boolean;
  /** Fires once all section heights are measured (desktop) or immediately on mount (mobile). */
  onLayoutStable?: () => void;
}

const groupLabelClassCompact = 'text-xs font-instrument-medium text-gray-500 uppercase tracking-wide mb-2';
const groupLabelClassDefault = 'text-xs font-instrument-medium text-gray-500 uppercase tracking-wide mb-3';

/**
 * Two-column layout that balances column heights by measuring each section and
 * assigning sections to left/right with bin packing. On mobile (isDesktop=false)
 * renders a single column. Reusable for any list of sections with optional group labels.
 */
export function BalancedTwoColumnLayout({
  sections,
  isDesktop = true,
  contentMaxWidth = DEFAULT_CONTENT_MAX_WIDTH,
  columnMaxWidth = DEFAULT_COLUMN_MAX_WIDTH,
  compact = false,
  onLayoutStable,
}: BalancedTwoColumnLayoutProps) {
  const groupLabelCls = compact ? groupLabelClassCompact : groupLabelClassDefault;
  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections]);
  const sectionIdsKey = sectionIds.join('|');
  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  const [heights, setHeights] = useState<Record<string, number>>({});
  const heightsRef = useRef<Record<string, number>>({});
  const debouncedFlushRef = useRef<(() => void) | null>(null);
  const layoutStableReportedRef = useRef(false);
  const onLayoutStableRef = useRef(onLayoutStable);
  onLayoutStableRef.current = onLayoutStable;

  useEffect(() => {
    setHeights({});
    heightsRef.current = {};
    layoutStableReportedRef.current = false;
    debouncedFlushRef.current = null;
  }, [sectionIdsKey]);

  const allMeasured =
    sectionIds.length > 0 && sectionIds.every((id) => (heights[id] ?? 0) > 0);

  const reportHeight = useCallback(
    (id: string, height: number) => {
      heightsRef.current[id] = height;
      const ready =
        sectionIds.length > 0 &&
        sectionIds.every((sectionId) => (heightsRef.current[sectionId] ?? 0) > 0);
      if (!ready) return;

      if (debouncedFlushRef.current == null) {
        debouncedFlushRef.current = debounce(() => {
          setHeights({ ...heightsRef.current });
          if (!layoutStableReportedRef.current) {
            layoutStableReportedRef.current = true;
            onLayoutStableRef.current?.();
          }
        }, HEIGHT_DEBOUNCE_MS);
      }
      debouncedFlushRef.current();
    },
    [sectionIds],
  );

  const assignment = useMemo(
    () => computeTwoColumnAssignment(sectionIds, allMeasured ? heights : {}),
    [sectionIds, heights, allMeasured],
  );

  useEffect(() => {
    if (!isDesktop && onLayoutStableRef.current && !layoutStableReportedRef.current) {
      layoutStableReportedRef.current = true;
      onLayoutStableRef.current();
    }
  }, [isDesktop, sectionIdsKey]);

  if (!isDesktop) {
    let lastGroupLabel: string | undefined;
    return (
      <View>
        {sections.map((section) => {
          const showGroupLabel = section.groupLabel != null && section.groupLabel !== lastGroupLabel;
          if (showGroupLabel) {
            lastGroupLabel = section.groupLabel;
          }
          return (
            <React.Fragment key={section.id}>
              {showGroupLabel && (
                <Text className={groupLabelCls}>{section.groupLabel}</Text>
              )}
              {section.content}
            </React.Fragment>
          );
        })}
      </View>
    );
  }

  const renderColumn = (ids: string[]) => {
    let lastGroupLabel: string | undefined;
    return (
      <View style={{ flex: 1, minWidth: 0, maxWidth: columnMaxWidth }}>
        {ids.map((id) => {
          const section = sectionMap.get(id);
          if (!section) return null;
          const showGroupLabel = section.groupLabel != null && section.groupLabel !== lastGroupLabel;
          if (showGroupLabel) {
            lastGroupLabel = section.groupLabel;
          }
          return (
            <React.Fragment key={id}>
              {showGroupLabel && (
                <Text className={groupLabelCls}>{section.groupLabel}</Text>
              )}
              <MeasuredSection id={id} onHeightMeasured={reportHeight}>
                {section.content}
              </MeasuredSection>
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 24,
        alignItems: 'flex-start',
        maxWidth: contentMaxWidth,
        alignSelf: 'center',
        width: '100%',
      }}
    >
      {renderColumn(assignment.left)}
      {renderColumn(assignment.right)}
    </View>
  );
}
