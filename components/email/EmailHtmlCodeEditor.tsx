import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { CodeEditorShell } from '@/components/ui/forms/CodeEditorShell';
import { HtmlSyntaxLayer } from '@/lib/editor/htmlSyntaxHighlight';

export interface EmailHtmlCodeEditorProps {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  placeholder?: string;
  minHeight?: number;
  trailingElement?: ReactNode;
  helperText?: string | null;
}

export function EmailHtmlCodeEditor({
  value,
  onChangeText,
  label = 'HTML',
  placeholder = '<table>...</table>',
  minHeight = 220,
  trailingElement,
  helperText = 'HTML is sanitized and repaired on save before preview and delivery.',
}: EmailHtmlCodeEditorProps) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text className="text-sm font-instrument-medium text-gray-300">
          {label}
        </Text>
        {trailingElement}
      </View>
      <CodeEditorShell
        value={value}
        onChange={onChangeText}
        minHeight={minHeight}
        syntaxLayer={<HtmlSyntaxLayer value={value} />}
        placeholder={placeholder}
        footer={
          helperText ? (
            <Text className="text-xs text-gray-500 mt-2">{helperText}</Text>
          ) : null
        }
      />
    </View>
  );
}

export default EmailHtmlCodeEditor;
