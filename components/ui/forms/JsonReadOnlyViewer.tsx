import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { JsonSyntaxLayer } from '@/lib/editor/jsonSyntaxHighlight';
import {
  CODE_EDITOR_FONT_FAMILY,
  CODE_EDITOR_LINE_HEIGHT,
  CODE_EDITOR_LINE_NUMBER_COLOR,
  CODE_EDITOR_WEB_CONTENT_STYLE,
  CODE_EDITOR_WEB_OVERLAY_INNER_STYLE,
} from '@/lib/editor/codeEditorStyles';

export interface JsonReadOnlyViewerProps {
  value: string;
  /** Max height before the viewer scrolls. Content sizes naturally below this. */
  maxHeight?: number;
}

export function JsonReadOnlyViewer({ value, maxHeight = 360 }: JsonReadOnlyViewerProps) {
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(value.split('\n').length, 1) }, (_, index) => index + 1),
    [value],
  );

  return (
    <View className="overflow-hidden rounded-xl border border-white/10 bg-[#0B0B0B]">
      <ScrollView
        style={maxHeight != null ? { maxHeight } : undefined}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        <View className="flex-row">
          <View className="items-end border-r border-white/10 bg-white/[0.02] px-3 py-3">
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
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator
            style={[{ flex: 1 }, CODE_EDITOR_WEB_CONTENT_STYLE]}
          >
            <View className="px-4 py-3" style={CODE_EDITOR_WEB_OVERLAY_INNER_STYLE}>
              <JsonSyntaxLayer value={value} selectable />
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}
