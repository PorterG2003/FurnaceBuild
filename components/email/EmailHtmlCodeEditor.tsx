import React from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

export interface EmailHtmlCodeEditorProps {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  placeholder?: string;
  minHeight?: number;
  trailingElement?: React.ReactNode;
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
      {Platform.OS === 'web' ? (
        React.createElement('textarea', {
          value,
          onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
          placeholder,
          spellCheck: false,
          style: {
            width: '100%',
            minHeight,
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.18)',
            backgroundColor: '#111111',
            color: '#F3F4F6',
            padding: 16,
            resize: 'vertical',
            fontFamily: 'Menlo, Monaco, Consolas, monospace',
            fontSize: 13,
            lineHeight: '20px',
            outline: 'none',
            whiteSpace: 'pre',
          },
        })
      ) : (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#666"
          className="border border-white/30 rounded-2xl px-4 py-4 bg-white/5 text-base text-white"
          style={{
            borderColor: '#FFFFFF30',
            backgroundColor: '#111111',
            color: '#F3F4F6',
            borderWidth: 1,
            minHeight,
            textAlignVertical: 'top',
            fontFamily: 'Courier',
            fontSize: 13,
            lineHeight: 20,
          }}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor="#FF4D00"
        />
      )}
      {helperText ? (
        <Text className="text-xs text-gray-500 mt-2">
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}

export default EmailHtmlCodeEditor;
