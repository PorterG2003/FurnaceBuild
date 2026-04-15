/**
 * Email node A/B variants stored in flow_data (builder) and mirrored in nodes.node_data.
 */

export const LEGACY_EMAIL_VARIANT_ID = 'a0000000-0000-4000-8000-000000000001';

export type EmailNodeVariant = {
  id: string;
  label: string;
  subject: string;
  template: string;
  body_html?: string;
  body_text?: string;
  isActive: boolean;
  order: number;
};

export function generateEmailVariantId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback (should be rare in Expo web)
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Alphabetic labels A–Z, then AA, AB, … */
export function labelForVariantIndex(index: number): string {
  if (index < 0) return 'A';
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function normalizeLegacyEmailNodeData(data: Record<string, unknown>): {
  variants: EmailNodeVariant[];
  legacyFields: Record<string, unknown>;
} {
  const raw = data as Record<string, unknown>;
  const existing = raw.variants;
  if (Array.isArray(existing) && existing.length > 0) {
    const variants = (existing as unknown[]).map((v, i) => normalizeOneVariant(v, i));
    const { variants: _v, ...rest } = raw;
    return { variants, legacyFields: rest };
  }

  const id = generateEmailVariantId();
  const variant: EmailNodeVariant = {
    id,
    label: 'A',
    subject: String(raw.subject ?? ''),
    template: String(raw.template ?? ''),
    body_html: raw.body_html != null ? String(raw.body_html) : undefined,
    body_text: raw.body_text != null ? String(raw.body_text) : undefined,
    isActive: true,
    order: 0,
  };
  const { subject, template, body_html, body_text, variants: _vv, ...rest } = raw;
  return { variants: [variant], legacyFields: rest };
}

function normalizeOneVariant(v: unknown, index: number): EmailNodeVariant {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  let id = typeof o.id === 'string' && o.id.length > 0 ? o.id : generateEmailVariantId();
  const order = typeof o.order === 'number' && !Number.isNaN(o.order) ? o.order : index;
  const label =
    typeof o.label === 'string' && o.label.length > 0 ? o.label : labelForVariantIndex(index);
  const isActive = o.isActive === false ? false : true;
  return {
    id,
    label,
    subject: String(o.subject ?? ''),
    template: String(o.template ?? ''),
    body_html: o.body_html != null ? String(o.body_html) : undefined,
    body_text: o.body_text != null ? String(o.body_text) : undefined,
    isActive,
    order,
  };
}

export function sortVariantsForRoundRobin(variants: EmailNodeVariant[]): EmailNodeVariant[] {
  return [...variants].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
}

export function activeVariantsSorted(variants: EmailNodeVariant[]): EmailNodeVariant[] {
  return sortVariantsForRoundRobin(variants.filter((v) => v.isActive));
}
