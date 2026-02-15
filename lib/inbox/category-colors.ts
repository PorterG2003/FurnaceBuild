/**
 * Colors for thread categories. Used by Select (header, filter) for consistent visual cues.
 */

export const THREAD_CATEGORY_COLORS: Record<string, string> = {
  'Lead replied': '#34D399',   // emerald – positive, engagement
  'Meeting set': '#818CF8',    // indigo – scheduled, committed
  'Not interested': '#94A3B8', // slate – muted, inactive
  'Follow up': '#FBBF24',     // amber – action / to-do
};

/**
 * Return the hex color for a known category, or null for null/empty/unknown (e.g. "No category").
 */
export function getCategoryColor(category: string | null): string | null {
  if (category == null || category === '') return null;
  return THREAD_CATEGORY_COLORS[category] ?? null;
}
