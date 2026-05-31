import { Platform } from 'react-native';

/** Prevent accidental text selection on display-only invite flow UI (web). */
export const INVITE_FLOW_NON_SELECTABLE_STYLE =
  Platform.OS === 'web' ? ({ userSelect: 'none' } as const) : undefined;

/** Keep form fields editable when the surrounding flow is non-selectable. */
export const INVITE_FLOW_TEXT_INPUT_STYLE =
  Platform.OS === 'web' ? ({ userSelect: 'text' } as const) : undefined;
