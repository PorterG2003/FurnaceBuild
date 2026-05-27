import { Platform, type ViewStyle } from 'react-native';

/** Gap between form field trigger and anchored dropdown (matches legacy Select). */
export const FORM_DROPDOWN_POPUP_GAP = 4;

export const FORM_DROPDOWN_MIN_WIDTH = 260;

export function getFormDropdownPanelStyle(options: {
  maxHeight: number;
  minWidth?: number;
  maxWidth?: number;
}): ViewStyle {
  const { maxHeight, minWidth = FORM_DROPDOWN_MIN_WIDTH, maxWidth } = options;
  return {
    maxHeight,
    minWidth,
    ...(maxWidth != null ? { maxWidth } : {}),
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0px 8px 16px rgba(0,0,0,0.35)' }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.35,
          shadowRadius: 16,
          elevation: 12,
        }),
  };
}
