import type { ContentAsset, ContentAssetType } from './types';

const CONTENT_ASSET_TYPES: ReadonlySet<string> = new Set(['case_study', 'testimonial', 'stat']);

function isContentAssetType(value: string): value is ContentAssetType {
  return CONTENT_ASSET_TYPES.has(value);
}

/** Parse `content_assets` jsonb (RPC or template row) into typed assets. */
export function parseContentAssets(raw: unknown): ContentAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentAsset[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.type !== 'string' || !isContentAssetType(o.type)) continue;
    if (typeof o.title !== 'string' || typeof o.body !== 'string') continue;
    const asset: ContentAsset = {
      id: o.id,
      type: o.type,
      title: o.title,
      body: o.body,
    };
    if (typeof o.metric === 'string') asset.metric = o.metric;
    if (typeof o.attribution === 'string') asset.attribution = o.attribution;
    if (typeof o.imageUrl === 'string') asset.imageUrl = o.imageUrl;
    if (Array.isArray(o.metrics)) {
      const metrics: ContentAsset['metrics'] = [];
      for (const m of o.metrics) {
        if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
        const entry = m as Record<string, unknown>;
        if (typeof entry.label === 'string' && typeof entry.value === 'string') {
          metrics.push({ label: entry.label, value: entry.value });
        }
      }
      if (metrics.length > 0) asset.metrics = metrics;
    }
    out.push(asset);
  }
  return out;
}
