import { TermsEditorPanel } from '@/components/platform/admin/wizard';

type ContractTermsStepProps = {
  title: string;
  templateLabel: string;
  markdown: string;
  onMarkdownChange: (value: string) => void;
  previewMarkdown: string;
  onResetToDefault?: () => void;
  placeholder?: string;
};

export function ContractTermsStep(props: ContractTermsStepProps) {
  return <TermsEditorPanel {...props} />;
}
