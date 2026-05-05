import type { Block, CompetitorAdAuditBlock, PageConfig, ThemeConfig } from './types';
import {
  DEFAULT_FLUX_BLOCK_STYLE_PRESET,
  FLUX_BLOCK_STYLE_PRESETS,
  type FluxBlockStylePreset,
} from './fluxPresentationTokens';

/**
 * Normalize DB jsonb into a renderable PageConfig, or null if there is nothing to show.
 */
export function coercePageConfig(raw: unknown): PageConfig | null {
  if (raw == null || typeof raw !== 'object') return null;
  const c = raw as Partial<PageConfig>;
  const blocks = Array.isArray(c.blocks) ? (c.blocks as Block[]) : [];
  if (blocks.length === 0) return null;

  const t = (c.theme && typeof c.theme === 'object' ? c.theme : {}) as Partial<ThemeConfig>;
  const primary = typeof t.primaryColor === 'string' ? t.primaryColor : '#4f46e5';
  const theme: ThemeConfig = {
    primaryColor: primary,
    accentColor: typeof t.accentColor === 'string' ? t.accentColor : primary,
    backgroundColor: typeof t.backgroundColor === 'string' ? t.backgroundColor : '#f5f5f5',
    textColor: typeof t.textColor === 'string' ? t.textColor : '#1a1a1a',
    fontFamily: typeof t.fontFamily === 'string' ? t.fontFamily : 'Inter',
    ...(typeof t.logoUrl === 'string' && t.logoUrl.length > 0 ? { logoUrl: t.logoUrl } : {}),
    blockStylePreset: FLUX_BLOCK_STYLE_PRESETS.includes(t.blockStylePreset as FluxBlockStylePreset)
      ? (t.blockStylePreset as FluxBlockStylePreset)
      : DEFAULT_FLUX_BLOCK_STYLE_PRESET,
    ...(typeof t.allowLongCopy === 'boolean' ? { allowLongCopy: t.allowLongCopy } : {}),
  };

  return {
    theme,
    prospectName: typeof c.prospectName === 'string' ? c.prospectName : ' ',
    companyName: typeof c.companyName === 'string' ? c.companyName : ' ',
    blocks,
  };
}

/** True when `page_config` has at least one block and can be shown publicly. */
export function hasRenderableFluxPageConfig(raw: unknown): boolean {
  return coercePageConfig(raw) != null;
}

const HTTP_PREFIX = /^https?:\/\//i;
const TRANSPARENCY_PREFIX = 'https://adstransparency.google.com/';

function competitorAuditBlockPublishable(block: CompetitorAdAuditBlock): boolean {
  const p = block.props;
  if (p.status !== 'ready' || p.competitors.length < 1 || p.competitors.length > 3) return false;
  for (const row of p.competitors) {
    if (!row.name?.trim()) return false;
    if (!row.mapImageUrl?.trim() || !HTTP_PREFIX.test(row.mapImageUrl.trim())) return false;
    if (!row.adsSummary?.trim()) return false;
    if (!Array.isArray(row.examples) || row.examples.length < 1 || row.examples.length > 2) return false;
    for (const ex of row.examples) {
      if (!ex.headline?.trim() || !ex.body?.trim() || !ex.sourceUrl?.trim()) return false;
      const u = ex.sourceUrl.trim();
      if (!u.startsWith(TRANSPARENCY_PREFIX)) return false;
    }
  }
  return true;
}

/**
 * True when the page may go **live**: renderable, and every `competitor_ad_audit` block is audit-ready with 1–3 competitor rows.
 */
export function canPublishFluxProspectPage(raw: unknown): boolean {
  if (!hasRenderableFluxPageConfig(raw)) return false;
  const c = coercePageConfig(raw);
  if (!c) return false;
  for (const block of c.blocks) {
    if (block.type === 'competitor_ad_audit' && !competitorAuditBlockPublishable(block)) {
      return false;
    }
  }
  return true;
}

export interface BuildTemplatePreviewPageConfigOptions {
  partialTheme?: Partial<ThemeConfig>;
  prospectName?: string;
  companyName?: string;
}

/**
 * Build a {@link PageConfig} for live template editing preview (campaign template has blocks + assets only).
 * Returns null when there are no blocks.
 */
export function buildTemplatePreviewPageConfig(
  blocks: Block[],
  options?: BuildTemplatePreviewPageConfigOptions,
): PageConfig | null {
  if (blocks.length === 0) return null;
  return coercePageConfig({
    blocks,
    theme: options?.partialTheme ?? {},
    prospectName: options?.prospectName ?? 'Preview contact',
    companyName: options?.companyName ?? 'Preview company',
  });
}
