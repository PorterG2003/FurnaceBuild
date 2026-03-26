/** Strip leading checkmarks / whitespace from enriched CSV company fields */
export function cleanCompanyNameForSearch(name: string): string {
  return name.replace(/^[\s✅✓]+/u, '').trim();
}
