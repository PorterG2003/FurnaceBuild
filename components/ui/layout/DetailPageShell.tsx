import React, { type ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { DetailPageHeader, type BreadcrumbItem } from './DetailPageHeader';
import { LAYOUT_BREAKPOINT } from './constants';
import { PageLayout } from './PageLayout';

interface DetailPageShellProps {
  breadcrumbItems: BreadcrumbItem[];
  backHref: string;
  title: string;
  subtitle?: string | null;
  actions?: ReactNode;
  mobileRightAction?: ReactNode;
  mobileToolbar?: ReactNode;
  contentPadding?: number;
  onBack?: () => void;
  children: ReactNode;
}

export function DetailPageShell({
  breadcrumbItems,
  backHref,
  title,
  subtitle,
  actions,
  mobileRightAction,
  mobileToolbar,
  contentPadding = 24,
  onBack,
  children,
}: DetailPageShellProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;

  return (
    <PageLayout scrollable={false} mobileLayout="scrollable" contentPadding={contentPadding}>
      <DetailPageHeader
        breadcrumbItems={breadcrumbItems}
        backHref={backHref}
        title={title}
        subtitle={subtitle}
        actions={actions}
        mobileRightAction={mobileRightAction}
        onBack={onBack}
      />
      {isMobile ? (
        <>
          {mobileToolbar != null ? <View className="mb-6">{mobileToolbar}</View> : null}
          {children}
        </>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: 24 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      )}
    </PageLayout>
  );
}
