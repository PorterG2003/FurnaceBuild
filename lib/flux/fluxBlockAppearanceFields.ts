import type { BlockType, FluxBlockAppearance } from './types';

export type FluxBlockAppearanceFieldKey = keyof FluxBlockAppearance;

export interface FluxBlockAppearanceFieldDef {
  key: FluxBlockAppearanceFieldKey;
  label: string;
  help?: string;
  placeholder?: string;
  fallbackHex?: string;
}

export const FLUX_BLOCK_APPEARANCE_FIELDS: Record<BlockType, FluxBlockAppearanceFieldDef[]> = {
  hero: [
    {
      key: 'sectionBackgroundColor',
      label: 'Section background',
      help: 'Full-width band behind the hero (centered and split layouts).',
      placeholder: '#4f46e5',
      fallbackHex: '#4f46e5',
    },
    {
      key: 'panelSurfaceColor',
      label: 'Side panel background',
      help: 'Image card column in the Elevated (split panel) layout.',
      placeholder: '#ffffff',
      fallbackHex: '#ffffff',
    },
    {
      key: 'headingColor',
      label: 'Headline color',
      help: 'Main hero headline only — not the logo bar at the top (Theme → Header).',
      placeholder: '#1a1a1a',
      fallbackHex: '#1a1a1a',
    },
    {
      key: 'mutedTextColor',
      label: 'Subheadline color',
      help: 'Text between the headline and the CTA button.',
      placeholder: '#6b7280',
      fallbackHex: '#6b7280',
    },
    { key: 'textColor', label: 'Other body text', placeholder: '#1a1a1a', fallbackHex: '#1a1a1a' },
    { key: 'primaryColor', label: 'Primary / CTA fill', placeholder: '#4f46e5', fallbackHex: '#4f46e5' },
    { key: 'onPrimaryColor', label: 'Text on primary buttons', placeholder: '#ffffff', fallbackHex: '#ffffff' },
  ],
  social_proof: [
    { key: 'sectionBackgroundColor', label: 'Section background', placeholder: '#f5f5f5', fallbackHex: '#f5f5f5' },
    { key: 'headingColor', label: 'Heading color', placeholder: '#1a1a1a', fallbackHex: '#1a1a1a' },
    { key: 'borderColor', label: 'Divider color', placeholder: '#e5e7eb', fallbackHex: '#e5e7eb' },
  ],
  case_study: [
    { key: 'sectionBackgroundColor', label: 'Section background', placeholder: '#f5f5f5', fallbackHex: '#f5f5f5' },
    { key: 'surfaceColor', label: 'Card background', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'headingColor', label: 'Heading color', placeholder: '#1a1a1a', fallbackHex: '#1a1a1a' },
  ],
  benefits: [
    { key: 'sectionBackgroundColor', label: 'Section background', placeholder: '#f5f5f5', fallbackHex: '#f5f5f5' },
    { key: 'headingColor', label: 'Heading color', placeholder: '#1a1a1a', fallbackHex: '#1a1a1a' },
    { key: 'surfaceColor', label: 'Icon tile background', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'borderColor', label: 'Row divider color', placeholder: '#e5e7eb', fallbackHex: '#e5e7eb' },
  ],
  testimonial: [
    { key: 'sectionBackgroundColor', label: 'Section background', placeholder: '#f5f5f5', fallbackHex: '#f5f5f5' },
    { key: 'surfaceColor', label: 'Quote card background', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'textColor', label: 'Quote text color', placeholder: '#1a1a1a', fallbackHex: '#1a1a1a' },
  ],
  cta: [
    { key: 'sectionBackgroundColor', label: 'Section background', placeholder: '#4f46e5', fallbackHex: '#4f46e5' },
    { key: 'primaryColor', label: 'Primary button fill', placeholder: '#4f46e5', fallbackHex: '#4f46e5' },
    { key: 'onPrimaryColor', label: 'Text on primary button', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'headingColor', label: 'Headline color', placeholder: '#ffffff', fallbackHex: '#ffffff' },
  ],
  tanners_tax_strategy: [
    { key: 'sectionBackgroundColor', label: 'Section background', placeholder: '#f5f5f5', fallbackHex: '#f5f5f5' },
    { key: 'surfaceColor', label: 'Input / option background', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'primaryColor', label: 'Accent / selection', placeholder: '#4f46e5', fallbackHex: '#4f46e5' },
    { key: 'onPrimaryColor', label: 'Text on primary button', placeholder: '#ffffff', fallbackHex: '#ffffff' },
  ],
  social_media_plan: [
    { key: 'sectionBackgroundColor', label: 'Section background', placeholder: '#f5f5f5', fallbackHex: '#f5f5f5' },
    { key: 'surfaceColor', label: 'Card background', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'headingColor', label: 'Heading color', placeholder: '#1a1a1a', fallbackHex: '#1a1a1a' },
  ],
  competitor_ad_audit: [
    { key: 'sectionBackgroundColor', label: 'Section background', placeholder: '#f5f5f5', fallbackHex: '#f5f5f5' },
    { key: 'surfaceColor', label: 'Card background', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'headingColor', label: 'Heading color', placeholder: '#1a1a1a', fallbackHex: '#1a1a1a' },
    { key: 'primaryColor', label: 'Link button fill', placeholder: '#4f46e5', fallbackHex: '#4f46e5' },
    { key: 'onPrimaryColor', label: 'Text on link button', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'accentColor', label: 'Accent (labels & badges)', placeholder: '#4f46e5', fallbackHex: '#4f46e5' },
    { key: 'errorColor', label: 'Error text color', placeholder: '#b91c1c', fallbackHex: '#b91c1c' },
  ],
  quiz_and_book: [
    { key: 'sectionBackgroundColor', label: 'Section background', placeholder: '#f5f5f5', fallbackHex: '#f5f5f5' },
    { key: 'surfaceColor', label: 'Step card background', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'primaryColor', label: 'Primary button fill', placeholder: '#4f46e5', fallbackHex: '#4f46e5' },
    { key: 'onPrimaryColor', label: 'Text on primary button', placeholder: '#ffffff', fallbackHex: '#ffffff' },
    { key: 'errorColor', label: 'Error text color', placeholder: '#b91c1c', fallbackHex: '#b91c1c' },
  ],
};

export const FLUX_THEME_ADVANCED_COLOR_FIELDS: Array<{
  key: keyof import('./types').ThemeConfig;
  label: string;
  placeholder: string;
  fallbackHex: string;
}> = [
  { key: 'surfaceColor', label: 'Surface (cards)', placeholder: '#ffffff', fallbackHex: '#ffffff' },
  { key: 'onPrimaryColor', label: 'Text on primary', placeholder: '#ffffff', fallbackHex: '#ffffff' },
  { key: 'onSurfaceColor', label: 'Text on surfaces', placeholder: '#1a1a1a', fallbackHex: '#1a1a1a' },
  { key: 'mutedTextColor', label: 'Muted text', placeholder: '#6b7280', fallbackHex: '#6b7280' },
  { key: 'borderColor', label: 'Border', placeholder: '#e5e7eb', fallbackHex: '#e5e7eb' },
  { key: 'strongBorderColor', label: 'Strong border', placeholder: '#d1d5db', fallbackHex: '#d1d5db' },
  { key: 'errorColor', label: 'Error', placeholder: '#b91c1c', fallbackHex: '#b91c1c' },
  { key: 'shadowColor', label: 'Shadow', placeholder: '#0f172a', fallbackHex: '#0f172a' },
];
