import type { ReactNode } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import { useLeadDetailMobilePage } from './mobile/LeadDetailMobilePageContext';

export function useLeadDetailLayout() {
  const { width } = useWindowDimensions();
  return { isMobile: width < LAYOUT_BREAKPOINT };
}

export function LeadDetailSection({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { isMobile } = useLeadDetailLayout();
  const { suppressSectionHeader } = useLeadDetailMobilePage();
  const hideSectionHeader = isMobile && suppressSectionHeader;

  const header = hideSectionHeader ? null : (
    <View className={isMobile ? 'border-b border-[#2A2A2A] pb-3' : undefined}>
      <Text className="text-lg font-instrument-semibold text-white">{title}</Text>
      {description ? (
        <Text className="text-sm text-gray-500 font-instrument mt-1 leading-5">{description}</Text>
      ) : null}
    </View>
  );

  const body = <View className="gap-4">{children}</View>;

  const footerSlot = footer ? (
    <View className={`border-t border-[#2A2A2A] ${isMobile ? 'pt-4 mt-4' : 'pt-5 mt-5'}`}>
      {footer}
    </View>
  ) : null;

  if (isMobile) {
    return (
      <View className="gap-4">
        {header}
        {body}
        {footerSlot}
      </View>
    );
  }

  return (
    <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
      <View className="gap-5">
        {header}
        {body}
      </View>
      {footerSlot}
    </View>
  );
}

export function LeadDetailSubsection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { isMobile } = useLeadDetailLayout();
  const { suppressSectionHeader } = useLeadDetailMobilePage();
  const hideTitle = isMobile && suppressSectionHeader;

  return (
    <View className="gap-4">
      {!hideTitle ? (
        <Text className="text-xs font-instrument-semibold uppercase tracking-wide text-gray-500">{title}</Text>
      ) : null}
      {children}
    </View>
  );
}

export function LeadDetailDivider() {
  return <View className="border-t border-[#2A2A2A]" />;
}

export function LeadDetailListShell({ children }: { children: ReactNode }) {
  const { isMobile } = useLeadDetailLayout();

  if (isMobile) {
    return <View className="gap-3">{children}</View>;
  }

  return (
    <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] overflow-hidden">
      {children}
    </View>
  );
}

export function LeadDetailListRow({
  children,
  highlighted = false,
  isLast = false,
}: {
  children: ReactNode;
  highlighted?: boolean;
  isLast?: boolean;
}) {
  const { isMobile } = useLeadDetailLayout();

  if (isMobile) {
    return (
      <View
        className={`rounded-xl border px-4 py-4 gap-3 ${
          highlighted ? 'border-brand-orange bg-[#F9731610]' : 'border-[#2A2A2A] bg-[#121212]'
        }`}
      >
        {children}
      </View>
    );
  }

  return (
    <View
      className={`px-5 py-4 gap-3 ${highlighted ? 'bg-[#F9731608]' : 'bg-transparent'} ${
        !isLast ? 'border-b border-[#2A2A2A]' : ''
      }`}
    >
      {children}
    </View>
  );
}
