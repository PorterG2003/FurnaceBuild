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
 * Extract unique variable keys (e.g. "first_name", "custom.xyz") from a template string.
 * Accepts one or more strings; duplicates are removed.
 */
export function extractVariableKeys(...texts: (string | undefined | null)[]): string[] {
  const keys = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const key = match[1].trim();
      if (key) keys.add(key);
    }
  }
  return Array.from(keys);
}

/**
 * Check whether a lead is missing at least one of the given variable values.
 * "Missing" means undefined, null, or whitespace-only string.
 */
export function hasMissingValues(lead: LeadLike, variableKeys: string[]): boolean {
  for (const key of variableKeys) {
    let value: unknown;
    if (key.startsWith('custom.')) {
      const subKey = key.slice(7);
      value = getNestedValue(lead.custom_lead_data ?? {}, subKey);
    } else {
      value = lead[key];
    }
    if (value == null || String(value).trim() === '') return true;
  }
  return false;
}

/**
 * Detect malformed variable-like patterns in template text.
 * Returns unique raw fragments that look like broken variable syntax, e.g.
 * "{first_name}", "{{first_name", "first_name}}".
 */
export function extractMalformedVariables(...texts: (string | undefined | null)[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    // Remove all valid {{...}} so we don't false-positive on them
    const stripped = text.replace(/\{\{[^}]+\}\}/g, '');
    // Single-brace variables: {word} but not part of double braces
    const singleBrace = /\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g;
    let m;
    while ((m = singleBrace.exec(stripped)) !== null) found.add(m[0]);
    // Unclosed double-brace: {{word without closing }}
    const unclosed = /\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\b(?!\}\})/g;
    while ((m = unclosed.exec(stripped)) !== null) found.add(m[0]);
    // Missing opening: word}} without preceding {{
    const noOpen = /(?<!\{\{)\b([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/g;
    while ((m = noOpen.exec(stripped)) !== null) found.add(m[0]);
  }
  return Array.from(found);
}

/**
 * Replace {{key}} and {{custom.xyz}} in template with values from lead.
 * Replaces with empty string when value is undefined or null.
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

    return value !== undefined && value !== null ? String(value) : '';
  });
}
