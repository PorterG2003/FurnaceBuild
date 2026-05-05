import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { supabase } from '@/lib/supabase/client';
import type { FluxProspectPageRow } from '@/lib/flux/types';
import { coercePageConfig } from '@/lib/flux/coercePageConfig';
import { PageRenderer } from '@/components/flux/PageRenderer';

function normalizeSlugParam(raw: string | string[] | undefined): string | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export default function PublicProspectPage() {
  const { slug: slugRaw } = useLocalSearchParams<{ slug: string | string[] }>();
  const slug = normalizeSlugParam(slugRaw);
  const [page, setPage] = useState<FluxProspectPageRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    (async () => {
      // Do not filter by status here: RLS allows anon only `live` rows; authenticated users in
      // the account can read drafts—matching Flux preview. A client-side `.eq('status','live')`
      // made `/p/{slug}` 404 for owners until they toggled Live.
      const { data, error } = await supabase
        .from('flux_prospect_pages')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
      } else {
        const row = data as FluxProspectPageRow;
        setPage(row);
        if (row.status === 'live' && coercePageConfig(row.page_config)) {
          void (async () => {
            try {
              await supabase.rpc('flux_increment_page_view', { p_slug: slug });
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
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#6b7280" />
      </View>
    );
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
