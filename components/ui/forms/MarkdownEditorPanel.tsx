import type { ReactNode } from 'react';
import { TextInput, View } from 'react-native';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';

type MarkdownEditorPanelProps = {
  markdown: string;
  onChange: (value: string) => void;
  renderPreview: (markdown: string) => ReactNode;
  placeholder?: string;
  onReset?: () => void;
  resetLabel?: string;
};

export function MarkdownEditorPanel({
  markdown,
  onChange,
  renderPreview,
  placeholder = 'Paste or edit markdown here',
}: MarkdownEditorPanelProps) {
  return (
    <View className="gap-5">
      <TextInput
        value={markdown}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={authPlaceholderColor}
        className={authInputClassName}
        style={{ ...authInputStyle, minHeight: 240, textAlignVertical: 'top' }}
        multiline
      />
      <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-4">
        {renderPreview(markdown || 'Preview will appear here.')}
      </View>
    </View>
  );
}
