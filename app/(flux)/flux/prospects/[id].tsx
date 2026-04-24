import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { PageRenderer } from '@/components/flux/PageRenderer';
import { FluxEditorSplitLayout } from '@/components/flux';
import {
  getFluxProspectById,
  getFluxPagesByProspect,
  getFluxCampaignById,
  ensureFluxTemplateExists,
  updateFluxPageStatus,
} from '@/lib/supabase/services/flux';
import type {
  FluxProspectRow,
  FluxProspectPageRow,
  FluxCampaignRow,
  FluxCampaignTemplateRow,
  FluxPageStatus,
} from '@/lib/flux/types';
import { coercePageConfig, hasRenderableFluxPageConfig } from '@/lib/flux/coercePageConfig';
import { getFluxGenerateUrl } from '@/lib/flux/fluxGenerateUrl';
import { callFluxGenerate } from '@/lib/flux/callFluxGenerate';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  live: 'bg-green-500/20 text-green-300 border-green-500/30',
  archived: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const STATUSES: FluxPageStatus[] = ['draft', 'live', 'archived'];

export default function ProspectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [prospect, setProspect] = useState<FluxProspectRow | null>(null);
  const [page, setPage] = useState<FluxProspectPageRow | null>(null);
  const [campaign, setCampaign] = useState<FluxCampaignRow | null>(null);
  const [template, setTemplate] = useState<FluxCampaignTemplateRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const p = await getFluxProspectById(id);
      if (!p) { router.back(); return; }
      setProspect(p);

      const [pages, c] = await Promise.all([
        getFluxPagesByProspect(id),
        getFluxCampaignById(p.campaign_id),
      ]);
      if (pages.length > 0) setPage(pages[0]);
      if (c) {
        setCampaign(c);
        setTemplate(await ensureFluxTemplateExists(c.id));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (status: FluxPageStatus) => {
    if (!page || statusUpdating) return;
    if (status === 'live' && !hasRenderableFluxPageConfig(page.page_config)) {
      Alert.alert(
        'Generate first',
        'Run Generate or Regenerate so this page has blocks and copy. Only then can it go live—the public URL reads the saved page config.',
      );
      return;
    }
    setStatusUpdating(true);
    try {
      const updated = await updateFluxPageStatus(page.id, status);
      setPage(updated);
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!prospect || !page || regenerating) return;

    setRegenerating(true);
    try {
      await ensureFluxTemplateExists(prospect.campaign_id);
      const result = await callFluxGenerate({
        prospectId: prospect.id,
        campaignId: prospect.campaign_id,
      });
      if (!result.ok) {
        Alert.alert('Generation failed', result.message);
        return;
      }
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to regenerate';
      Alert.alert('Error', msg);
    } finally {
      setRegenerating(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!page) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = origin ? `${origin}/p/${page.slug}` : `/p/${page.slug}`;

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        Alert.alert('Copied', url);
      } catch {
        Alert.alert('Copy failed', 'Unable to copy to clipboard.');
      }
      return;
    }

    try {
      await Share.share({ message: url, url });
    } catch {
      Alert.alert('Share failed', 'Unable to open the share sheet.');
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#6b7280" />
      </View>
    );
  }

  if (!prospect) return null;

  const previewConfig = page ? coercePageConfig(page.page_config) : null;
  const hasPageConfig = previewConfig != null;
  const fluxGenerateConfigured = Boolean(getFluxGenerateUrl());

  return (
    <FluxEditorSplitLayout
      header={(
        <View className="px-4 pt-2 pb-3 border-b border-[#2A2A2A]">
          <Pressable onPress={() => router.back()}>
            <Text className="text-gray-400 text-sm font-instrument">← Back</Text>
          </Pressable>
        </View>
      )}
      editor={(
        <>
      {!fluxGenerateConfigured && (
        <View className="border border-red-500/40 bg-red-500/10 rounded-xl p-4 mb-4">
          <Text className="text-red-100 text-sm font-instrument-semibold mb-1">Generate is not wired</Text>
          <Text className="text-red-100/90 text-xs font-instrument leading-5">
            The app needs the Flux Lambda Function URL. After `npx ampx sandbox` or deploy, your root{' '}
            <Text className="font-mono">amplify_outputs.json</Text> should include{' '}
            <Text className="font-mono">custom.fluxGenerateUrl</Text>. Restart Expo if you just generated that file.
            Alternatively set <Text className="font-mono">EXPO_PUBLIC_FLUX_GENERATE_URL</Text> in{' '}
            <Text className="font-mono">.env.local</Text> to that URL. The Lambda also needs secrets:{' '}
            <Text className="font-mono">OPENROUTER_API_KEY</Text>, <Text className="font-mono">SUPABASE_SECRET_KEY</Text>.
          </Text>
        </View>
      )}

      <View className="flex-row items-start justify-between mb-6">
        <View className="flex-1 mr-4">
          <Text className="text-white text-xl font-instrument-semibold">{prospect.name}</Text>
          <Text className="text-gray-400 text-sm font-instrument">{prospect.company}{prospect.role ? ` · ${prospect.role}` : ''}</Text>
          {campaign && <Text className="text-gray-500 text-xs font-instrument mt-1">Campaign: {campaign.name}</Text>}
        </View>
      </View>

      {page?.status === 'live' && !hasRenderableFluxPageConfig(page.page_config) && (
        <View className="border border-amber-500/40 bg-amber-500/10 rounded-xl p-4 mb-4">
          <Text className="text-amber-100 text-sm font-instrument leading-5">
            Status is <Text className="font-instrument-semibold">live</Text> but there is no generated page yet (empty config).
            The public URL will not show content until you run Generate or Regenerate, or you can switch back to draft.
          </Text>
        </View>
      )}

      {/* Controls */}
      {page && (
        <View className="border border-[#2A2A2A] rounded-xl p-4 bg-[#1A1A1A] mb-6">
          <View className="flex-row items-center justify-between mb-3">
            <View>
              <Text className="text-gray-400 text-xs font-instrument mb-1">Slug</Text>
              <Text className="text-white text-sm font-instrument-semibold">/p/{page.slug}</Text>
            </View>
            <Button size="sm" variant="secondary" onPress={handleCopyUrl}>Copy URL</Button>
          </View>

          <View className="flex-row items-center gap-2 mb-3">
            <Text className="text-gray-400 text-xs font-instrument mr-2">Status:</Text>
            {STATUSES.map((s) => (
              <Pressable
                key={s}
                className={`px-3 py-1 rounded-lg border ${page.status === s ? STATUS_COLORS[s] : 'border-[#3A3A3A] bg-[#2A2A2A]'}`}
                onPress={() => handleStatusChange(s)}
                disabled={
                  statusUpdating ||
                  (s === 'live' && !hasRenderableFluxPageConfig(page.page_config))
                }
              >
                <Text className={`text-xs font-instrument-semibold ${page.status === s ? '' : 'text-gray-400'}`}>{s}</Text>
              </Pressable>
            ))}
          </View>

          <View className="flex-row items-center gap-4">
            <Button size="sm" onPress={handleRegenerate} disabled={regenerating}>
              {regenerating ? 'Generating...' : 'Regenerate'}
            </Button>
            <View>
              <Text className="text-gray-500 text-xs font-instrument">{page.view_count} views</Text>
              {page.last_viewed_at && (
                <Text className="text-gray-600 text-xs font-instrument">
                  Last: {new Date(page.last_viewed_at).toLocaleDateString()}
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      {!hasPageConfig && page && (
        <View className="border border-[#2A2A2A] rounded-xl p-6 items-center mb-6">
          <Text className="text-gray-400 text-sm font-instrument mb-3">Page not yet generated.</Text>
          <Button size="sm" onPress={handleRegenerate} disabled={regenerating}>
            {regenerating ? 'Generating...' : 'Generate Now'}
          </Button>
        </View>
      )}

      {/* Prospect metadata (collapsible) */}
      <Pressable
        className="border border-[#2A2A2A] rounded-xl p-3 bg-[#1A1A1A] mb-3"
        onPress={() => setShowMeta(!showMeta)}
      >
        <Text className="text-gray-400 text-sm font-instrument">{showMeta ? '▾' : '▸'} Prospect Details</Text>
      </Pressable>
      {showMeta && (
        <View className="border border-[#2A2A2A] border-t-0 rounded-b-xl p-4 bg-[#1A1A1A] gap-2 mb-4">
          <MetaRow label="Name" value={prospect.name} />
          <MetaRow label="Company" value={prospect.company} />
          <MetaRow label="Role" value={prospect.role} />
          <MetaRow label="URL" value={prospect.url} />
          <MetaRow label="Industry" value={prospect.industry} />
          <MetaRow label="Company Size" value={prospect.company_size} />
          <MetaRow label="Email Notes" value={prospect.email_notes} />
          {prospect.brand_profile && (
            <>
              <MetaRow label="Primary Color" value={prospect.brand_profile.primaryColor} />
              <MetaRow label="Accent Color" value={prospect.brand_profile.accentColor} />
              <MetaRow label="Font" value={prospect.brand_profile.fontFamily} />
              <MetaRow label="Logo URL" value={prospect.brand_profile.logoUrl} />
            </>
          )}
        </View>
      )}
        </>
      )}
      preview={(
        hasPageConfig && page && previewConfig ? (
          <PageRenderer
            config={previewConfig}
            assets={template?.content_assets || []}
            scrollable={false}
          />
        ) : (
          <View className="py-12 px-6 items-center justify-center min-h-[200px]">
            <Text className="text-gray-500 text-sm font-instrument text-center">
              {page
                ? 'Generate the page from the Editor tab to see a live preview here.'
                : 'No prospect page yet.'}
            </Text>
          </View>
        )
      )}
    />
  );
}

function MetaRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View className="flex-row">
      <Text className="text-gray-500 text-xs font-instrument w-28">{label}</Text>
      <Text className="text-gray-300 text-xs font-instrument flex-1">{value}</Text>
    </View>
  );
}
