import type { ViewStyle } from 'react-native';
import type { ThemeConfig } from './types';

export const FLUX_BLOCK_STYLE_PRESETS = ['classic', 'minimal', 'elevated', 'outlined', 'soft'] as const;

export type FluxBlockStylePreset = (typeof FLUX_BLOCK_STYLE_PRESETS)[number];

export const DEFAULT_FLUX_BLOCK_STYLE_PRESET: FluxBlockStylePreset = 'classic';

export const FLUX_BLOCK_STYLE_PRESET_OPTIONS: Array<{
  id: FluxBlockStylePreset;
  label: string;
  description: string;
}> = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Centered marketing sections with familiar card grids and full-width CTA bands.',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Editorial, left-aligned sections with narrow measures and restrained list layouts.',
  },
  {
    id: 'elevated',
    label: 'Elevated',
    description: 'Modern SaaS panels, split compositions, large feature tiles, and layered cards.',
  },
  {
    id: 'outlined',
    label: 'Outlined',
    description: 'Report-like sections with strong rules, numbered rows, and compact framed CTAs.',
  },
  {
    id: 'soft',
    label: 'Soft',
    description: 'Warm, conversational layouts with rounded panels, bubbles, and pill actions.',
  },
];

export interface FluxPresentationTokens {
  preset: FluxBlockStylePreset;
  layouts: {
    hero: 'centered' | 'editorial' | 'splitPanel' | 'documentHeader' | 'conversational';
    benefits: 'cardGrid' | 'checklist' | 'featureTiles' | 'numberedRows' | 'softCards';
    caseStudy: 'compactCard' | 'report' | 'splitMetric' | 'dossier' | 'storyPanel';
    proof: 'logoRow' | 'inline' | 'cardStrip' | 'ledger' | 'pillCloud';
    testimonial: 'simpleQuote' | 'pullQuote' | 'quoteCard' | 'citation' | 'speechBubble';
    cta: 'band' | 'inline' | 'raisedCard' | 'outlinedBar' | 'softPanel';
    complex: 'cards' | 'editorial' | 'dashboard' | 'document' | 'soft';
  };
  surfaceColor: string;
  sectionBackgroundColor: string;
  textColor: string;
  mutedTextOpacity: number;
  subtleTextOpacity: number;
  radii: {
    card: number;
    button: number;
    chip: number;
    input: number;
    media: number;
    icon: number;
    highlight: number;
  };
  card: ViewStyle;
  strongCard: ViewStyle;
  tintedCard: ViewStyle;
  input: ViewStyle;
  chip: ViewStyle;
  outlineChip: ViewStyle;
  primaryButton: ViewStyle;
  secondaryButton: ViewStyle;
  logoBar: ViewStyle;
  highlightFrame: ViewStyle;
}

const FALLBACK_BORDER = '#e5e7eb';
const FALLBACK_STRONG_BORDER = '#d1d5db';

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function withFluxAlpha(color: string, alphaHex: string): string {
  return isHexColor(color) ? `${color}${alphaHex}` : color;
}

function shadow(depth: 'none' | 'soft' | 'medium'): ViewStyle {
  if (depth === 'none') return {};
  if (depth === 'soft') {
    return {
      shadowColor: '#0f172a',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 18,
      elevation: 2,
    };
  }
  return {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 4,
  };
}

function normalizePreset(preset: unknown): FluxBlockStylePreset {
  return FLUX_BLOCK_STYLE_PRESETS.includes(preset as FluxBlockStylePreset)
    ? (preset as FluxBlockStylePreset)
    : DEFAULT_FLUX_BLOCK_STYLE_PRESET;
}

export function getFluxPresentationTokens(theme: ThemeConfig): FluxPresentationTokens {
  const preset = normalizePreset(theme.blockStylePreset);
  const surfaceColor = '#ffffff';
  const primaryTint = withFluxAlpha(theme.primaryColor, '14');
  const accentTint = withFluxAlpha(theme.accentColor || theme.primaryColor, '16');

  const config = {
    classic: {
      layouts: {
        hero: 'centered',
        benefits: 'cardGrid',
        caseStudy: 'compactCard',
        proof: 'logoRow',
        testimonial: 'simpleQuote',
        cta: 'band',
        complex: 'cards',
      },
      cardRadius: 12,
      buttonRadius: 8,
      chipRadius: 8,
      inputRadius: 8,
      mediaRadius: 10,
      borderWidth: 0,
      borderColor: withFluxAlpha(theme.primaryColor, '30'),
      strongBorderColor: withFluxAlpha(theme.primaryColor, '40'),
      depth: 'none' as const,
      mutedTextOpacity: 0.68,
      subtleTextOpacity: 0.5,
    },
    minimal: {
      layouts: {
        hero: 'editorial',
        benefits: 'checklist',
        caseStudy: 'report',
        proof: 'inline',
        testimonial: 'pullQuote',
        cta: 'inline',
        complex: 'editorial',
      },
      cardRadius: 6,
      buttonRadius: 6,
      chipRadius: 4,
      inputRadius: 6,
      mediaRadius: 6,
      borderWidth: 1,
      borderColor: FALLBACK_BORDER,
      strongBorderColor: FALLBACK_STRONG_BORDER,
      depth: 'none' as const,
      mutedTextOpacity: 0.64,
      subtleTextOpacity: 0.48,
    },
    elevated: {
      layouts: {
        hero: 'splitPanel',
        benefits: 'featureTiles',
        caseStudy: 'splitMetric',
        proof: 'cardStrip',
        testimonial: 'quoteCard',
        cta: 'raisedCard',
        complex: 'dashboard',
      },
      cardRadius: 22,
      buttonRadius: 14,
      chipRadius: 10,
      inputRadius: 12,
      mediaRadius: 16,
      borderWidth: 0,
      borderColor: 'transparent',
      strongBorderColor: withFluxAlpha(theme.primaryColor, '28'),
      depth: 'medium' as const,
      mutedTextOpacity: 0.7,
      subtleTextOpacity: 0.56,
    },
    outlined: {
      layouts: {
        hero: 'documentHeader',
        benefits: 'numberedRows',
        caseStudy: 'dossier',
        proof: 'ledger',
        testimonial: 'citation',
        cta: 'outlinedBar',
        complex: 'document',
      },
      cardRadius: 8,
      buttonRadius: 6,
      chipRadius: 6,
      inputRadius: 6,
      mediaRadius: 6,
      borderWidth: 1,
      borderColor: FALLBACK_STRONG_BORDER,
      strongBorderColor: '#9ca3af',
      depth: 'none' as const,
      mutedTextOpacity: 0.66,
      subtleTextOpacity: 0.52,
    },
    soft: {
      layouts: {
        hero: 'conversational',
        benefits: 'softCards',
        caseStudy: 'storyPanel',
        proof: 'pillCloud',
        testimonial: 'speechBubble',
        cta: 'softPanel',
        complex: 'soft',
      },
      cardRadius: 20,
      buttonRadius: 999,
      chipRadius: 999,
      inputRadius: 14,
      mediaRadius: 16,
      borderWidth: 1,
      borderColor: withFluxAlpha(theme.primaryColor, '18'),
      strongBorderColor: withFluxAlpha(theme.primaryColor, '32'),
      depth: 'soft' as const,
      mutedTextOpacity: 0.72,
      subtleTextOpacity: 0.56,
    },
  }[preset];

  const baseCard: ViewStyle = {
    backgroundColor: surfaceColor,
    borderRadius: config.cardRadius,
    borderWidth: config.borderWidth,
    borderColor: config.borderColor,
    ...shadow(config.depth),
  };

  return {
    preset,
    layouts: config.layouts as FluxPresentationTokens['layouts'],
    surfaceColor,
    sectionBackgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    mutedTextOpacity: config.mutedTextOpacity,
    subtleTextOpacity: config.subtleTextOpacity,
    radii: {
      card: config.cardRadius,
      button: config.buttonRadius,
      chip: config.chipRadius,
      input: config.inputRadius,
      media: config.mediaRadius,
      icon: Math.max(6, Math.round(config.cardRadius * 0.75)),
      highlight: Math.max(8, config.cardRadius),
    },
    card: baseCard,
    strongCard: {
      ...baseCard,
      borderWidth: Math.max(1, config.borderWidth),
      borderColor: config.strongBorderColor,
    },
    tintedCard: {
      ...baseCard,
      backgroundColor: preset === 'minimal' || preset === 'outlined' ? surfaceColor : primaryTint,
      borderWidth: Math.max(1, config.borderWidth),
      borderColor: config.strongBorderColor,
    },
    input: {
      backgroundColor: surfaceColor,
      borderRadius: config.inputRadius,
      borderWidth: 1,
      borderColor: config.borderColor === 'transparent' ? FALLBACK_BORDER : config.borderColor,
    },
    chip: {
      backgroundColor: accentTint,
      borderRadius: config.chipRadius,
    },
    outlineChip: {
      borderRadius: config.chipRadius,
      borderWidth: 1,
      borderColor: config.strongBorderColor,
    },
    primaryButton: {
      borderRadius: config.buttonRadius,
      backgroundColor: theme.primaryColor,
    },
    secondaryButton: {
      borderRadius: config.buttonRadius,
      backgroundColor: surfaceColor,
    },
    logoBar: {
      backgroundColor: surfaceColor,
      borderBottomWidth: preset === 'minimal' || preset === 'outlined' ? 1 : 0,
      borderBottomColor: config.borderColor,
    },
    highlightFrame: {
      borderWidth: 2,
      borderColor: theme.accentColor || theme.primaryColor || '#6366f1',
      marginHorizontal: 4,
      marginVertical: 2,
      borderRadius: Math.max(10, config.cardRadius),
      overflow: 'hidden',
    },
  };
}
