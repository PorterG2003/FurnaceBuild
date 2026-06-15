import type { FluxProspectPageRow } from './types';

type FluxProspectPageReader = {
  from: (table: 'flux_prospect_pages') => {
    select: (query: string) => {
      eq: (column: 'slug', value: string) => {
        maybeSingle: () => Promise<{ data: FluxProspectPageRow | null; error: unknown }>;
      };
    };
  };
};

export type LoadedFluxProspectPageAccess = 'public' | 'account';

export interface LoadedFluxProspectPageResult {
  page: FluxProspectPageRow | null;
  access: LoadedFluxProspectPageAccess | null;
}

async function readFluxProspectPage(
  client: FluxProspectPageReader,
  slug: string,
): Promise<FluxProspectPageRow | null> {
  try {
    const { data, error } = await client
      .from('flux_prospect_pages')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Public pages should resolve like a true public route even for signed-in users.
 * Try the anonymous client first so live pages are always visible, then fall back
 * to the authenticated client to preserve owner draft preview on `/p/{slug}`.
 */
export async function loadFluxProspectPage(
  slug: string,
  clients: {
    publicClient?: FluxProspectPageReader;
    authenticatedClient?: FluxProspectPageReader;
  } = {},
): Promise<LoadedFluxProspectPageResult> {
  const publicClient =
    clients.publicClient ??
    (await import('@/lib/supabase/publicClient')).publicSupabase;
  const authenticatedClient =
    clients.authenticatedClient ??
    (await import('@/lib/supabase/client')).supabase;

  const publicPage = await readFluxProspectPage(publicClient, slug);
  if (publicPage) {
    return { page: publicPage, access: 'public' };
  }

  const authenticatedPage = await readFluxProspectPage(authenticatedClient, slug);
  if (authenticatedPage) {
    return { page: authenticatedPage, access: 'account' };
  }

  return { page: null, access: null };
}
