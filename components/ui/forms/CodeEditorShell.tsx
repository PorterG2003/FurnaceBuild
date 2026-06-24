import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import { View, Text, TextInput, type TextInput as TextInputType } from 'react-native';
import {
  CODE_EDITOR_CARET_COLOR,
  CODE_EDITOR_FONT_FAMILY,
  CODE_EDITOR_LINE_HEIGHT,
  CODE_EDITOR_LINE_NUMBER_COLOR,
  CODE_EDITOR_TEXT_STYLE,
  CODE_EDITOR_WEB_CONTENT_STYLE,
  CODE_EDITOR_WEB_OVERLAY_INNER_STYLE,
} from '@/lib/editor/codeEditorStyles';
import type { TextSelection } from '@/lib/editor/insertTextAtSelection';

export interface CodeEditorShellProps {
  value: string;
  onChange: (value: string) => void;
  minHeight: number;
  syntaxLayer: ReactNode;
  showLineNumbers?: boolean;
  headerTitle?: string;
  headerRight?: ReactNode;
  footer?: ReactNode;
  placeholder?: string;
  selection?: TextSelection;
  onSelectionChange?: (selection: TextSelection) => void;
  inputRef?: RefObject<TextInputType | null>;
}

export function CodeEditorShell({
  value,
  onChange,
  minHeight,
  syntaxLayer,
  showLineNumbers = true,
  headerTitle,
  headerRight,
  footer,
  placeholder,
  selection: controlledSelection,
  onSelectionChange,
  inputRef,
}: CodeEditorShellProps) {
  const [editorHeight, setEditorHeight] = useState(minHeight);
  const [internalSelection, setInternalSelection] = useState<TextSelection>({
    start: value.length,
    end: value.length,
  });

  const selection = controlledSelection ?? internalSelection;
  const setSelection = (next: TextSelection) => {
    if (controlledSelection === undefined) {
      setInternalSelection(next);
    }
    onSelectionChange?.(next);
  };

  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(value.split('\n').length, 1) }, (_, index) => index + 1),
    [value]
  );
  const resolvedHeight = Math.max(editorHeight, minHeight);
  const overlayMinHeight = resolvedHeight - 24;
  const hasHeader = headerTitle != null || headerRight != null;

  return (
    <View>
      <View className="overflow-hidden rounded-xl border border-white/10 bg-[#0B0B0B]">
        {hasHeader ? (
          <View className="flex-row items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
            {headerTitle ? (
              <Text className="text-[11px] font-instrument-medium uppercase tracking-[0.2em] text-gray-400">
                {headerTitle}
              </Text>
            ) : (
              <View />
            )}
            {headerRight ? (
              <View className="flex-row items-center gap-3">{headerRight}</View>
            ) : null}
          </View>
        ) : null}
        <View className="flex-row">
          {showLineNumbers ? (
            <View
              className="items-end border-r border-white/10 bg-white/[0.02] px-3 py-3"
              style={{ minHeight: resolvedHeight }}
            >
              {lineNumbers.map((line) => (
                <Text
                  key={line}
                  style={{
                    color: CODE_EDITOR_LINE_NUMBER_COLOR,
                    fontFamily: CODE_EDITOR_FONT_FAMILY,
                    fontSize: 11,
                    lineHeight: CODE_EDITOR_LINE_HEIGHT,
                  }}
                >
                  {line}
                </Text>
              ))}
            </View>
          ) : null}
          <View
            className="flex-1 px-4 py-3"
            style={[{ minHeight: resolvedHeight }, CODE_EDITOR_WEB_CONTENT_STYLE]}
          >
            <View
              style={[
                { position: 'relative', minHeight: overlayMinHeight },
                CODE_EDITOR_WEB_OVERLAY_INNER_STYLE,
              ]}
            >
              <View pointerEvents="none">{syntaxLayer}</View>
              <TextInput
                ref={inputRef}
                value={value}
                onChangeText={onChange}
                placeholder={placeholder}
                placeholderTextColor="#6B7280"
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
                  ...CODE_EDITOR_TEXT_STYLE,
                  minHeight: overlayMinHeight,
                  padding: 0,
                  textAlignVertical: 'top',
                  ...(typeof window !== 'undefined' ? { caretColor: CODE_EDITOR_CARET_COLOR } : null),
                }}
                selectionColor={CODE_EDITOR_CARET_COLOR}
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
      {footer ? <View>{footer}</View> : null}
    </View>
  );
}
