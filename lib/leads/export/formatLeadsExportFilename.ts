export function formatLeadsExportFilename(baseName: string | null | undefined, fallbackId?: string | null): string {
  const safeBaseName = (baseName ?? 'leads-export')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'leads-export';

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safeId = fallbackId?.trim();
  return safeId ? `${safeBaseName}-${safeId}-${timestamp}.csv` : `${safeBaseName}-${timestamp}.csv`;
}
