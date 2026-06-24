import type { TextStyle, ViewStyle } from 'react-native';

export const CODE_EDITOR_FONT_FAMILY = 'Menlo, Consolas, monospace';
export const CODE_EDITOR_FONT_SIZE = 13;
export const CODE_EDITOR_LINE_HEIGHT = 22;
export const CODE_EDITOR_CARET_COLOR = '#FF4D00';
export const CODE_EDITOR_LINE_NUMBER_COLOR = '#6B7280';
export const CODE_EDITOR_DEFAULT_TEXT_COLOR = '#E5E7EB';

const isWeb = typeof window !== 'undefined';

/** Shared monospace text style for input + syntax layers (no soft-wrap on web). */
export const CODE_EDITOR_TEXT_STYLE: TextStyle = {
  fontFamily: CODE_EDITOR_FONT_FAMILY,
  fontSize: CODE_EDITOR_FONT_SIZE,
  lineHeight: CODE_EDITOR_LINE_HEIGHT,
  ...(isWeb
    ? {
        whiteSpace: 'pre',
        overflowWrap: 'normal',
      }
    : null),
};

/** Horizontally scrollable editor pane on web; gutter stays fixed. */
export const CODE_EDITOR_WEB_CONTENT_STYLE: ViewStyle = isWeb
  ? {
      overflowX: 'auto',
      overflowY: 'hidden',
    }
  : {};

/** Expands overlay width to longest line so syntax and input scroll together. */
export const CODE_EDITOR_WEB_OVERLAY_INNER_STYLE: ViewStyle = {
  minWidth: '100%',
  ...(isWeb ? { width: 'max-content' as ViewStyle['width'] } : null),
};
