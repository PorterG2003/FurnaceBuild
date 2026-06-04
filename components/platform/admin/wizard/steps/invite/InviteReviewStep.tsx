import type { ReactNode } from 'react';
import { WizardReviewPanel } from '@/components/ui/wizard';
import type { PlatformContractViewData } from '@/lib/platform/contract/types';
import { PlatformInviteAdminInlinePreview } from '@/components/platform/invite/PlatformInviteAdminInlinePreview';

type InviteReviewStepProps = {
  message: string;
  summaryLines: Array<{ label: string; value: string }>;
  reviewPreviewData: PlatformContractViewData | null;
  children?: ReactNode;
};

export function InviteReviewStep({
  message,
  summaryLines,
  reviewPreviewData,
  children,
}: InviteReviewStepProps) {
  return (
    <WizardReviewPanel
      message={message}
      summaryLines={summaryLines}
      preview={<PlatformInviteAdminInlinePreview draftData={reviewPreviewData} />}
    >
      {children}
    </WizardReviewPanel>
  );
}
