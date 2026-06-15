import { parseContentAssets } from './parseContentAssets';
import type { ContentAsset } from './types';

/** Load case study / testimonial assets for a prospect page (live public or owner draft on /p/{slug}). */
export type FluxContentAssetsRpcClient = {
  rpc: (
    fn: 'flux_resolve_page_content_assets',
    args: { p_slug: string },
  ) => Promise<{ data: unknown; error: unknown }>;
};

export async function fetchFluxPageContentAssets(
  slug: string,
  client?: FluxContentAssetsRpcClient,
): Promise<ContentAsset[]> {
  const trimmed = slug.trim();
  if (!trimmed) return [];
  try {
    const rpcClient =
      client ?? (await import('@/lib/supabase/publicClient')).publicSupabase;
    const { data, error } = await rpcClient.rpc('flux_resolve_page_content_assets', {
      p_slug: trimmed,
    });
    if (error) return [];
    return parseContentAssets(data);
  } catch {
    return [];
  }
}
