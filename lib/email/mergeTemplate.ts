/**
 * Merge template with lead data for preview (e.g. in builder).
 * Supports {{field}} for top-level fields and {{custom.field_name}} for custom_lead_data.
 * Matches the logic in workers/send-worker/src/email.ts.
 */

/** Lead-like object: top-level fields + optional custom_lead_data (nested key-value). */
export type LeadLike = Record<string, unknown> & {
  custom_lead_data?: Record<string, unknown> | null;
};

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Replace {{key}} and {{custom.xyz}} in template with values from lead.
 * Leaves placeholder unchanged when value is missing or null.
 */
export function mergeTemplate(template: string, lead: LeadLike): string {
  if (!template) return '';

  return template.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmedKey = key.trim();
    if (!trimmedKey) return match;

    let value: unknown;
    if (trimmedKey.startsWith('custom.')) {
      const subKey = trimmedKey.slice(7);
      value = getNestedValue(lead.custom_lead_data ?? {}, subKey);
    } else {
      value = lead[trimmedKey];
    }

    return value !== undefined && value !== null ? String(value) : match;
  });
}
