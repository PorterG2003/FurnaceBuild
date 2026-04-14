export interface CsvBuilderNormalizedHeader {
  key: string;
  originalHeader: string;
  displayHeader: string;
  normalizedHeader: string;
}

function sanitizeHeaderLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
}

function normalizeHeaderValue(value: string): string {
  return sanitizeHeaderLabel(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCsvBuilderHeaders(rawHeaders: string[]): {
  headers: CsvBuilderNormalizedHeader[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const seenDisplay = new Map<string, number>();
  const headers = rawHeaders.map((rawHeader, index) => {
    const originalHeader = typeof rawHeader === 'string' ? rawHeader : '';
    const sanitized = sanitizeHeaderLabel(originalHeader);
    const displayBase = sanitized || `Column ${index + 1}`;
    const seenCount = seenDisplay.get(displayBase) ?? 0;
    seenDisplay.set(displayBase, seenCount + 1);
    const displayHeader = seenCount === 0 ? displayBase : `${displayBase} (${seenCount + 1})`;
    if (!sanitized) warnings.push(`Column ${index + 1} had no header label. A fallback label was generated.`);
    if (seenCount > 0) warnings.push(`Duplicate header "${displayBase}" was renamed to "${displayHeader}" for display.`);
    return {
      key: `c${String(index + 1).padStart(3, '0')}`,
      originalHeader,
      displayHeader,
      normalizedHeader: normalizeHeaderValue(displayBase),
    };
  });
  return { headers, warnings };
}
