import React, { type ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LAYOUT_BREAKPOINT } from './constants';
import { PageLayout } from './PageLayout';

/** Matches DetailPageShell mobile `contentPadding` (16px). */
const MOBILE_EDGE_PADDING = 16;
const DESKTOP_EDGE_PADDING = 24;
const HEADER_TO_CONTENT_GAP = 8;

export interface MobileFormPageLayoutProps {
  header: ReactNode;
  children: ReactNode;
  /** Extra scroll padding below safe-area clearance. */
  scrollBottomExtra?: number;
}

/**
 * Standard layout for mobile full-page forms (enrich, replace lead, etc.):
 * fixed header, padded edges aligned with detail pages, scrollable body.
 */
export function MobileFormPageLayout({
  header,
  children,
  scrollBottomExtra = 16,
}: MobileFormPageLayoutProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const edgePadding = isMobile ? MOBILE_EDGE_PADDING : DESKTOP_EDGE_PADDING;

  return (
    <PageLayout
      scrollable={false}
      mobileLayout="fixed"
      hideMobileBottomNav={isMobile}
    >
      <View
        className="flex-1 min-h-0"
        style={{
          paddingTop: edgePadding,
          paddingHorizontal: edgePadding,
        }}
      >
        {header}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingTop: HEADER_TO_CONTENT_GAP,
            paddingBottom: Math.max(insets.bottom, MOBILE_EDGE_PADDING) + scrollBottomExtra,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    </PageLayout>
  );
}
