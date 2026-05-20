import { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, type TextInput as TextInputType } from 'react-native';
import { MergeTagVariablePicker } from '@/components/builder/MergeTagVariablePicker';
import {
  extractMalformedVariables,
  extractVariableKeys,
  type LeadVariable,
} from '@/lib/email/index';

const JSON_EDITOR_LINE_HEIGHT = 22;
const JSON_EDITOR_FONT_SIZE = 13;
const JSON_EDITOR_FONT_FAMILY = 'Menlo, Consolas, monospace';
const jsonTokenRegex =
  /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}\[\]:,]/g;

function getJsonTokenColor(token: string, isKey: boolean): string {
  if (token.startsWith('"')) {
    return isKey ? '#93C5FD' : '#86EFAC';
  }
  if (token === 'true' || token === 'false') {
    return '#F9A8D4';
  }
  if (token === 'null') {
    return '#C4B5FD';
  }
  if (/^-?\d/.test(token)) {
    return '#FCA5A5';
  }
  if (/^[{}\[\]:,]$/.test(token)) {
    return '#6B7280';
  }
  return '#E5E7EB';
}

function JsonSyntaxText({ value }: { value: string }) {
  const parts: Array<{ text: string; color: string }> = [];
  let lastIndex = 0;

  for (const match of value.matchAll(jsonTokenRegex)) {
    const token = match[0];
    const start = match.index ?? 0;
    const nextNonWhitespace = value.slice(start + token.length).match(/\S/)?.[0];
    const isKey = token.startsWith('"') && nextNonWhitespace === ':';

    if (start > lastIndex) {
      parts.push({
        text: value.slice(lastIndex, start),
        color: '#E5E7EB',
      });
    }

    parts.push({
      text: token,
      color: getJsonTokenColor(token, isKey),
    });

    lastIndex = start + token.length;
  }

  if (lastIndex < value.length) {
    parts.push({
      text: value.slice(lastIndex),
      color: '#E5E7EB',
    });
  }

  if (parts.length === 0) {
    parts.push({
      text: '{"key": "value"}',
      color: '#6B7280',
    });
  }

  return (
    <Text
      style={{
        color: '#E5E7EB',
        fontFamily: JSON_EDITOR_FONT_FAMILY,
        fontSize: JSON_EDITOR_FONT_SIZE,
        lineHeight: JSON_EDITOR_LINE_HEIGHT,
      }}
    >
      {parts.map((part, index) => (
        <Text key={`${index}-${part.text.slice(0, 12)}`} style={{ color: part.color }}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

function insertTextAtSelection(
  text: string,
  selection: { start: number; end: number },
  insert: string
): { text: string; selection: { start: number; end: number } } {
  const before = text.slice(0, selection.start);
  const after = text.slice(selection.end);
  const nextText = before + insert + after;
  const cursor = selection.start + insert.length;
  return { text: nextText, selection: { start: cursor, end: cursor } };
}

export interface JsonPayloadEditorProps {
  value: string;
  onChange: (value: string) => void;
  variables: LeadVariable[];
  minHeight: number;
  jsonError?: string | null;
}

export function JsonPayloadEditor({
  value,
  onChange,
  variables,
  minHeight,
  jsonError = null,
}: JsonPayloadEditorProps) {
  const inputRef = useRef<TextInputType>(null);
  const [editorHeight, setEditorHeight] = useState(minHeight);
  const [selection, setSelection] = useState({ start: value.length, end: value.length });

  const payloadLineNumbers = useMemo(
    () => Array.from({ length: Math.max(value.split('\n').length, 1) }, (_, index) => index + 1),
    [value]
  );
  const resolvedHeight = Math.max(editorHeight, minHeight);

  const validKeys = useMemo(
    () => new Set(variables.map((v) => v.token.replace(/^\{\{|\}\}$/g, ''))),
    [variables]
  );
  const variableKeys = useMemo(() => extractVariableKeys(value), [value]);
  const unknownKeys = useMemo(
    () => variableKeys.filter((k) => !validKeys.has(k)),
    [variableKeys, validKeys]
  );
  const malformedVars = useMemo(() => extractMalformedVariables(value), [value]);

  const handleSelectVariable = (token: string) => {
    const next = insertTextAtSelection(value, selection, token);
    onChange(next.text);
    setSelection(next.selection);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  return (
    <View>
      <View className="overflow-hidden rounded-xl border border-white/10 bg-[#0B0B0B]">
        <View className="flex-row items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
          <Text className="text-[11px] font-instrument-medium uppercase tracking-[0.2em] text-gray-400">
            JSON Payload
          </Text>
          <View className="flex-row items-center gap-3">
            <Text
              className={`text-xs font-instrument ${jsonError ? 'text-red-300' : 'text-emerald-300'}`}
            >
              {jsonError ? 'Invalid JSON' : 'Valid JSON'}
            </Text>
            <MergeTagVariablePicker variables={variables} onSelect={handleSelectVariable} />
          </View>
        </View>
        <View className="flex-row">
          <View
            className="items-end border-r border-white/10 bg-white/[0.02] px-3 py-3"
            style={{ minHeight: resolvedHeight }}
          >
            {payloadLineNumbers.map((line) => (
              <Text
                key={line}
                style={{
                  color: '#6B7280',
                  fontFamily: JSON_EDITOR_FONT_FAMILY,
                  fontSize: 11,
                  lineHeight: JSON_EDITOR_LINE_HEIGHT,
                }}
              >
                {line}
              </Text>
            ))}
          </View>
          <View className="flex-1 px-4 py-3" style={{ minHeight: resolvedHeight }}>
            <View style={{ minHeight: resolvedHeight - 24 }}>
              <View pointerEvents="none">
                <JsonSyntaxText value={value} />
              </View>
              <TextInput
                ref={inputRef}
                value={value}
                onChangeText={onChange}
                onSelectionChange={(event) => {
                  setSelection(event.nativeEvent.selection);
                }}
                selection={selection}
                onContentSizeChange={(event) => {
                  const nextHeight = Math.max(
                    minHeight,
                    Math.ceil(event.nativeEvent.contentSize.height)
                  );
                  if (Math.abs(nextHeight - editorHeight) > 4) {
                    setEditorHeight(nextHeight);
                  }
                }}
                className="absolute inset-0 text-base"
                style={{
                  color: 'transparent',
                  fontFamily: JSON_EDITOR_FONT_FAMILY,
                  fontSize: JSON_EDITOR_FONT_SIZE,
                  lineHeight: JSON_EDITOR_LINE_HEIGHT,
                  minHeight: resolvedHeight - 24,
                  padding: 0,
                  textAlignVertical: 'top',
                  ...(typeof window !== 'undefined' ? { caretColor: '#FF4D00' } : null),
                }}
                selectionColor="#FF4D00"
                underlineColorAndroid="transparent"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                multiline
                scrollEnabled={false}
                textAlignVertical="top"
              />
            </View>
          </View>
        </View>
      </View>
      {jsonError ? (
        <Text className="text-xs text-red-300 mt-2">{jsonError}</Text>
      ) : malformedVars.length > 0 ? (
        <Text className="text-xs text-amber-300 mt-2">
          Malformed variable syntax: {malformedVars.join(', ')}
        </Text>
      ) : unknownKeys.length > 0 ? (
        <Text className="text-xs text-amber-300 mt-2">
          Unknown variables: {unknownKeys.map((k) => `{{${k}}}`).join(', ')}
        </Text>
      ) : (
        <Text className="text-xs text-gray-500 mt-2">
          Use Variables to insert merge tags at the cursor. Tags must be inside JSON string values.
        </Text>
      )}
    </View>
  );
}
