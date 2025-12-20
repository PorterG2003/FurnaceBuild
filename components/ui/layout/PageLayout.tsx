import React from 'react';
import { View, ScrollView } from 'react-native';
import { NavBar } from './NavBar';

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
 * Standard page layout component with NavBar sidebar
 * Used across all main app pages for consistent layout
 */
export function PageLayout({
  children,
  scrollable = true,
  contentPadding = 24,
  contentClassName,
}: PageLayoutProps) {
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

