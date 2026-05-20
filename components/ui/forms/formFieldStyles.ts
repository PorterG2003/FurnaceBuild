/**
 * Shared field chrome for text inputs and picker triggers.
 * - `solid`: modals, settings forms (dark fill, gray border)
 * - `glass`: toolbars, filters (translucent fill)
 */
export type FormFieldVariant = 'solid' | 'glass';

/** Matches Tailwind `rounded-lg` — single source for field corners. */
export const FORM_FIELD_BORDER_RADIUS = 8;

export const FORM_FIELD_VARIANTS = {
  solid: {
    borderRadius: FORM_FIELD_BORDER_RADIUS,
    triggerBorderRadius: {
      default: FORM_FIELD_BORDER_RADIUS,
      compact: FORM_FIELD_BORDER_RADIUS,
    },
    panelSearchBorderRadius: FORM_FIELD_BORDER_RADIUS,
    labelClassName: 'text-sm font-instrument-medium mb-2 text-gray-300',
    hintClassName: 'text-xs text-gray-500 mt-2 font-instrument',
    placeholderTextColor: '#9CA3AF',
    inputStyle: {
      borderColor: '#3A3A3A',
      backgroundColor: '#121212',
      color: '#FFFFFF',
      borderWidth: 1,
      borderRadius: FORM_FIELD_BORDER_RADIUS,
    },
    inputClassName: 'border px-3 py-2.5 bg-[#121212] text-sm text-white font-instrument',
    trigger: {
      borderColor: '#3A3A3A',
      backgroundColor: '#121212',
      borderWidth: 1,
    },
    triggerTextColor: '#FFFFFF',
    triggerPlaceholderColor: '#9CA3AF',
    panelSearch: {
      backgroundColor: '#121212',
      borderColor: '#3A3A3A',
    },
  },
  glass: {
    borderRadius: FORM_FIELD_BORDER_RADIUS,
    triggerBorderRadius: {
      default: 12,
      compact: FORM_FIELD_BORDER_RADIUS,
    },
    panelSearchBorderRadius: 10,
    labelClassName: 'text-xs font-instrument-medium mb-2 text-gray-400',
    hintClassName: 'text-xs text-gray-500 mt-2 font-instrument',
    placeholderTextColor: '#666666',
    inputStyle: {
      borderColor: '#FFFFFF4D',
      backgroundColor: '#FFFFFF0D',
      color: '#FFFFFF',
      borderWidth: 1,
      borderRadius: FORM_FIELD_BORDER_RADIUS,
    },
    inputClassName: 'border px-3 py-2.5 text-sm text-white font-instrument',
    trigger: {
      borderColor: '#FFFFFF4D',
      backgroundColor: '#FFFFFF0D',
      borderWidth: 1,
    },
    triggerTextColor: '#FFFFFF',
    triggerPlaceholderColor: '#666666',
    panelSearch: {
      backgroundColor: '#FFFFFF0D',
      borderColor: '#FFFFFF4D',
    },
  },
} as const;

/** @deprecated Import `FORM_FIELD_VARIANTS.solid.inputStyle` or use `FormTextField`. */
export const formFieldSolidInputStyle = FORM_FIELD_VARIANTS.solid.inputStyle;
