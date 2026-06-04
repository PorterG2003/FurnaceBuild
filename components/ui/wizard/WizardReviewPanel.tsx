import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Alert } from '@/components/ui/feedback';

type SummaryLine = {
  label: string;
  value: string;
};

type WizardReviewPanelProps = {
  message: string;
  preview: ReactNode;
  summaryLines: SummaryLine[];
  children?: ReactNode;
};

export function WizardReviewPanel({
  message,
  preview,
  summaryLines,
  children,
}: WizardReviewPanelProps) {
  return (
    <View className="gap-6">
      <Alert variant="info" message={message} />
      {children}
      {preview}
      <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 gap-4">
        <View className="gap-2">
          {summaryLines.map((line) => (
            <Text key={line.label} className="text-gray-400 font-instrument text-sm">
              {line.label}: {line.value}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

/** @deprecated Use WizardReviewPanel */
export const ContractReviewPanel = WizardReviewPanel;
