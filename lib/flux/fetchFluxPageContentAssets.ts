import { supabase } from '@/lib/supabase/client';
import { parseContentAssets } from './parseContentAssets';
import type { ContentAsset } from './types';

/** Load case study / testimonial assets for a prospect page (live public or owner draft on /p/{slug}). */
export async function fetchFluxPageContentAssets(slug: string): Promise<ContentAsset[]> {
  const trimmed = slug.trim();
  if (!trimmed) return [];
  try {
    const { data, error } = await supabase.rpc('flux_resolve_page_content_assets', {
      p_slug: trimmed,
    });
    if (error) return [];
    return parseContentAssets(data);
  } catch {
    return [];
  }
}
