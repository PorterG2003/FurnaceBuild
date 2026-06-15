import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { useLocalSearchParams, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import { supabase } from '@/lib/supabase/client';
import { publicSupabase } from '@/lib/supabase/publicClient';
import type { FluxProspectPageRow } from '@/lib/flux/types';
import { coercePageConfig } from '@/lib/flux/coercePageConfig';
import { fetchFluxPageContentAssets } from '@/lib/flux/fetchFluxPageContentAssets';
import { loadFluxProspectPage } from '@/lib/flux/loadFluxProspectPage';
import type { ContentAsset } from '@/lib/flux/types';
import { PageRenderer } from '@/components/flux/PageRenderer';
import { resolveFluxPublicPageSlug } from '@/lib/web/fluxPublicPageSlug';

export default function PublicProspectPage() {
  const { slug: slugRaw } = useLocalSearchParams<{ slug: string | string[] }>();
  const pathname = usePathname();
  const slug = useMemo(() => {
    const fromPath =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.pathname
        : pathname;
    return resolveFluxPublicPageSlug(slugRaw, fromPath);
  }, [slugRaw, pathname]);
  const [page, setPage] = useState<FluxProspectPageRow | null>(null);
  const [contentAssets, setContentAssets] = useState<ContentAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setNotFound(false);
      setPage(null);
      setContentAssets([]);

      const { page, access } = await loadFluxProspectPage(slug);

      if (!page) {
        setNotFound(true);
        setContentAssets([]);
      } else {
        const row = page as FluxProspectPageRow;
        setPage(row);
        const pageClient = access === 'account' ? supabase : publicSupabase;
        const assets = await fetchFluxPageContentAssets(slug, pageClient);
        setContentAssets(assets);
        if (row.status === 'live' && coercePageConfig(row.page_config)) {
          void (async () => {
            try {
              await publicSupabase.rpc('flux_increment_page_view', { p_slug: slug });
            } catch {
              // ignore view-count failures (e.g. RPC not deployed yet)
            }
          })();
        }
      }
      setLoading(false);
    })();
  }, [slug]);

  if (loading) {
    return <View className="flex-1 bg-white" />;
  }

  if (notFound || !page) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-2xl font-instrument-semibold text-gray-800 mb-2 text-center">
          Page not found
        </Text>
        <Text className="text-gray-500 text-sm text-center">
          This link is not available. The page may still be a draft (set it Live in Flux to share publicly), or it was removed.
        </Text>
      </View>
    );
  }

  const config = coercePageConfig(page.page_config);
  if (!config) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-2xl font-instrument-semibold text-gray-800 mb-2 text-center">
          Page not available
        </Text>
        <Text className="text-gray-500 text-sm text-center">
          The owner marked this page live before any content was generated. Ask them to open Flux, run Generate or Regenerate, then try again—or set the page to draft until it is ready.
        </Text>
      </View>
    );
  }

  const heroBlock = config.blocks.find((b) => b.type === 'hero');
  const heroSubheadline = heroBlock?.type === 'hero' ? heroBlock.props.subheadline : '';
  const pageTitle = `${config.companyName} — ${config.prospectName}`;

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta property="og:title" content={pageTitle} />
        {heroSubheadline ? <meta property="og:description" content={heroSubheadline} /> : null}
        {config.theme.logoUrl ? <meta property="og:image" content={config.theme.logoUrl} /> : null}
      </Head>
      <PageRenderer
        config={config}
        assets={contentAssets}
        runtimeContext={{
          isPublicPage: page.status === 'live',
          pageId: page.id,
          pageSlug: page.slug,
          prospectName: config.prospectName,
          companyName: config.companyName,
        }}
      />
    </>
  );
}
