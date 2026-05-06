import React from 'react';
import { View, ScrollView, useWindowDimensions } from 'react-native';
import { NavBar } from './NavBar';
import { BottomNavBar, BOTTOM_NAV_SCROLL_PADDING } from './BottomNavBar';
import { LAYOUT_BREAKPOINT } from './constants';
export type MobileLayoutMode = 'scrollable' | 'fixed';

interface PageLayoutProps {
  children: React.ReactNode;
  /**
   * If true, wraps children in a ScrollView with default padding (desktop).
   * If false, children are rendered as-is without ScrollView (desktop).
   */
  scrollable?: boolean;
  /**
   * Mobile only: 'scrollable' = one ScrollView with padding and bottom nav clearance;
   * 'fixed' = fixed height container, no scroll. Defaults to 'scrollable' when scrollable=true, 'fixed' when scrollable=false.
   */
  mobileLayout?: MobileLayoutMode;
  /**
   * Padding for scrollable content (default: 24). On mobile scrollable pages, also used for bottom nav clearance.
   */
  contentPadding?: number;
  /**
   * Mobile fixed only: optional bottom padding/margin to clear the nav bar (default: 0).
   */
  mobileFixedBottomPadding?: number;
  /**
   * Additional className for the main content area
   */
  contentClassName?: string;
  /**
   * Mobile only: hide the bottom nav for immersive/full-screen flows like forms.
   */
  hideMobileBottomNav?: boolean;
}

/**
 * Standard page layout component with NavBar sidebar (desktop) or
 * bottom tab bar (mobile). Used across all main app pages for consistent layout.
 * Mobile: use mobileLayout='scrollable' for single-scroll pages with padding; 'fixed' for custom layouts.
 */
export function PageLayout({
  children,
  scrollable = true,
  mobileLayout: mobileLayoutProp,
  contentPadding = 16,
  mobileFixedBottomPadding = 0,
  contentClassName,
  hideMobileBottomNav = false,
}: PageLayoutProps) {
  const { width } = useWindowDimensions();
  const isMobileLayout = width < LAYOUT_BREAKPOINT;
  const mobileLayout: MobileLayoutMode = mobileLayoutProp ?? (scrollable ? 'scrollable' : 'fixed');
  if (isMobileLayout) {
    return (
      <View className="flex-1 bg-[#121212]">
        <View className={`flex-1 relative ${contentClassName || ''}`}>
          {mobileLayout === 'scrollable' ? (
            <ScrollView
              className="flex-1"
              contentContainerStyle={{
                padding: contentPadding,
                paddingBottom: contentPadding + (hideMobileBottomNav ? 0 : BOTTOM_NAV_SCROLL_PADDING),
                flexGrow: 1,
              }}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View
              className="flex-1"
              style={mobileFixedBottomPadding > 0 ? { paddingBottom: mobileFixedBottomPadding } : undefined}
            >
              {children}
            </View>
          )}
        </View>
        {!hideMobileBottomNav ? <BottomNavBar /> : null}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#121212] flex-row">
      <NavBar />
      {/* Main Content Area */}
      <View className={`flex-1 relative ${contentClassName || ''}`}>
        {scrollable ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: contentPadding }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

