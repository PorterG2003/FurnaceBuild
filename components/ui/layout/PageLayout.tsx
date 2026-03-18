import React from 'react';
import { View, ScrollView, useWindowDimensions } from 'react-native';
import { NavBar } from './NavBar';
import { BottomNavBar, BOTTOM_NAV_SCROLL_PADDING } from './BottomNavBar';
import { LAYOUT_BREAKPOINT } from './constants';

interface PageLayoutProps {
  children: React.ReactNode;
  /**
   * If true, wraps children in a ScrollView with default padding
   * If false, children are rendered as-is without ScrollView
   */
  scrollable?: boolean;
  /**
   * Padding for scrollable content (default: 24)
   */
  contentPadding?: number;
  /**
   * Additional className for the main content area
   */
  contentClassName?: string;
}

/**
 * Standard page layout component with NavBar sidebar (desktop) or
 * bottom tab bar (mobile). Used across all main app pages for consistent layout.
 */
export function PageLayout({
  children,
  scrollable = true,
  contentPadding = 24,
  contentClassName,
}: PageLayoutProps) {
  const { width } = useWindowDimensions();
  const isMobileLayout = width < LAYOUT_BREAKPOINT;

  if (isMobileLayout) {
    return (
      <View className="flex-1 bg-[#121212]">
        <View className={`flex-1 relative ${contentClassName || ''}`}>
          {scrollable ? (
            <ScrollView
              className="flex-1"
              contentContainerStyle={{
                padding: contentPadding,
                paddingBottom: contentPadding + BOTTOM_NAV_SCROLL_PADDING,
                flexGrow: 1,
              }}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
        <BottomNavBar />
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

