export const MANUAL_SMART_HANDLING_VERSION = '2026.06.22';
export const CATEGORIZER_PROMPT_VERSION = 'categorizer-v2';

export function resolveSuggestionVersion(mode: 'manual' | 'ai'): string {
  return mode === 'ai' ? CATEGORIZER_PROMPT_VERSION : MANUAL_SMART_HANDLING_VERSION;
}
