import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import {
  DETAIL_CONTENT_MAX_WIDTH,
  DetailPageShell,
  LAYOUT_BREAKPOINT,
  type BreadcrumbItem,
} from '@/components/ui/layout';
import { WizardStepIndicator } from './WizardStepIndicator';

type WizardPageShellProps = {
  breadcrumbItems: BreadcrumbItem[];
  backHref: string;
  title: string;
  subtitle?: string | null;
  steps: readonly string[];
  activeStepIndex: number;
  onStepPress?: (index: number) => void;
  stepperWrap?: boolean;
  footer?: ReactNode;
  children: ReactNode;
};

export function WizardPageShell({
  breadcrumbItems,
  backHref,
  title,
  subtitle,
  steps,
  activeStepIndex,
  onStepPress,
  stepperWrap = true,
  footer,
  children,
}: WizardPageShellProps) {
  const { width } = useWindowDimensions();
  const isMobile = width < LAYOUT_BREAKPOINT;
  const contentWidthStyle = isMobile
    ? undefined
    : { maxWidth: DETAIL_CONTENT_MAX_WIDTH, width: '100%' as const, alignSelf: 'center' as const };

  return (
    <DetailPageShell
      breadcrumbItems={breadcrumbItems}
      backHref={backHref}
      title={title}
      subtitle={subtitle}
    >
      <View style={contentWidthStyle} className="gap-6 w-full">
        <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
          <WizardStepIndicator
            steps={steps}
            activeIndex={activeStepIndex}
            wrap={stepperWrap}
            onStepPress={onStepPress}
          />
        </View>
        <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
          {children}
        </View>
        {footer ? <View className="gap-3">{footer}</View> : null}
      </View>
    </DetailPageShell>
  );
}

/** @deprecated Use WizardPageShell */
export const AdminWizardShell = WizardPageShell;
