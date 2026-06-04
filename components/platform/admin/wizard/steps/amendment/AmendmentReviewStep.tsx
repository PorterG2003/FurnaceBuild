import type { ReactNode } from 'react';
import { View } from 'react-native';
import { WizardReviewPanel } from '@/components/ui/wizard';
import type { PlatformContractViewData } from '@/lib/platform/contract/types';
import { PlatformInviteAdminEmbeddedPreview } from '@/components/platform/invite/PlatformInviteAdminEmbeddedPreview';
import { AmendmentReviewActions } from './AmendmentReviewActions';

type AmendmentReviewStepProps = {
  message: string;
  summaryLines: Array<{ label: string; value: string }>;
  reviewPreviewData: PlatformContractViewData | null;
  saving: boolean;
  onBack: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
  children?: ReactNode;
};

export function AmendmentReviewStep({
  message,
  summaryLines,
  reviewPreviewData,
  saving,
  onBack,
  onSaveDraft,
  onPublish,
  children,
}: AmendmentReviewStepProps) {
  return (
    <View className="gap-6">
      <WizardReviewPanel
        message={message}
        summaryLines={summaryLines}
        preview={(
          <PlatformInviteAdminEmbeddedPreview
            source="draft"
            draftData={reviewPreviewData}
            showTitle={false}
          />
        )}
      >
        {children}
      </WizardReviewPanel>
      <AmendmentReviewActions
        saving={saving}
        onBack={onBack}
        onSaveDraft={onSaveDraft}
        onPublish={onPublish}
      />
    </View>
  );
}
