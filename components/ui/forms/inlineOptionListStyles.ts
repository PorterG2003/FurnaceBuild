import { Platform } from 'react-native';

export const INLINE_OPTION_LIST_ROW_SIZING = {
  rowGap: 10,
  rowPaddingY: 10,
  rowPaddingX: 12,
  rowRadius: 12,
  rowMarginBottom: 6,
  checkboxSize: 18,
  checkboxRadius: 4,
  rowTextClassName: 'text-sm',
} as const;

export const inlineOptionListNoSelectStyle =
  Platform.OS === 'web' ? ({ userSelect: 'none' } as const) : undefined;

export function inlineOptionListCompactCardStyle() {
  return {
    borderRadius: INLINE_OPTION_LIST_ROW_SIZING.rowRadius,
    marginBottom: 4,
    borderWidth: 1,
    backgroundColor: '#121212',
    borderColor: '#2A2A2A',
    paddingVertical: 6,
    paddingHorizontal: INLINE_OPTION_LIST_ROW_SIZING.rowPaddingX,
    ...inlineOptionListNoSelectStyle,
  };
}

export function inlineOptionListCardStyle() {
  return inlineOptionListCompactCardStyle();
}

export function inlineOptionListRowStyle(isSelected: boolean) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: INLINE_OPTION_LIST_ROW_SIZING.rowGap,
    paddingVertical: INLINE_OPTION_LIST_ROW_SIZING.rowPaddingY,
    paddingHorizontal: INLINE_OPTION_LIST_ROW_SIZING.rowPaddingX,
    borderRadius: INLINE_OPTION_LIST_ROW_SIZING.rowRadius,
    marginBottom: INLINE_OPTION_LIST_ROW_SIZING.rowMarginBottom,
    borderWidth: 1,
    backgroundColor: isSelected ? 'rgba(243, 68, 13, 0.14)' : '#121212',
    borderColor: isSelected ? 'rgba(243, 68, 13, 0.4)' : '#2A2A2A',
    ...inlineOptionListNoSelectStyle,
  };
}
