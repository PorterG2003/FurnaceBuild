import type { TextStyle } from 'react-native';

/** Matches main app inputs (e.g. account profile fields). */
export const authInputStyle = {
  borderColor: '#3A3A3A',
  backgroundColor: '#121212',
  color: '#FFFFFF',
  borderWidth: 1,
} as const satisfies TextStyle;

export const authInputClassName =
  'border rounded-lg px-3 py-2.5 bg-[#121212] text-sm text-white border-[#3A3A3A]';

export const authLabelClassName = 'text-xs text-gray-400 font-instrument-medium mb-2';

export const authPlaceholderColor = '#9CA3AF';
