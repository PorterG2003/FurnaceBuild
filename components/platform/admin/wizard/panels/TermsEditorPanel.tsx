import { Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { FormFieldGroup } from '@/components/ui/forms/FormFieldGroup';
import { MarkdownEditorPanel } from '@/components/ui/forms/MarkdownEditorPanel';
import { PlatformTermsMarkdown } from '@/components/platform/contract/PlatformTermsMarkdown';

type TermsEditorPanelProps = {
  title: string;
  templateLabel: string;
  markdown: string;
  onMarkdownChange: (value: string) => void;
  previewMarkdown: string;
  onResetToDefault?: () => void;
  placeholder?: string;
};

export function TermsEditorPanel({
  title,
  templateLabel,
  markdown,
  onMarkdownChange,
  previewMarkdown,
  onResetToDefault,
  placeholder = 'Paste or edit the full agreement markdown here',
}: TermsEditorPanelProps) {
  const previewSource = markdown || previewMarkdown || 'Agreement preview will appear here.';

  return (
    <View className="gap-5">
      <FormFieldGroup label="Agreement template">
        <View className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
          <Text className="text-white font-instrument-medium">{title}</Text>
          <Text className="mt-1 text-sm font-instrument text-gray-400">{templateLabel}</Text>
        </View>
      </FormFieldGroup>
      <FormFieldGroup label="Raw markdown">
        <MarkdownEditorPanel
          markdown={markdown}
          onChange={onMarkdownChange}
          placeholder={placeholder}
          renderPreview={(md) => (
            <PlatformTermsMarkdown markdown={md || previewSource} />
          )}
        />
      </FormFieldGroup>
      {onResetToDefault ? (
        <View className="flex-row gap-3">
          <Button variant="outline" className="flex-1" onPress={onResetToDefault}>
            Reset to default template
          </Button>
        </View>
      ) : null}
    </View>
  );
}
