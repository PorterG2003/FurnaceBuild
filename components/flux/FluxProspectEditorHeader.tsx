import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms/Select';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  fluxPanelActionRowClass,
  fluxPanelAlertCardClass,
  fluxPanelSectionCardClass,
} from '@/lib/flux/fluxEditorPanelClasses';
import type { FluxCampaignRow, FluxPageStatus, FluxProspectPageRow, FluxProspectRow } from '@/lib/flux/types';
import { canPublishFluxProspectPage, hasRenderableFluxPageConfig } from '@/lib/flux/coercePageConfig';

const STATUS_ITEM_COLORS: Record<FluxPageStatus, string> = {
  draft: '#eab308',
  live: '#22c55e',
  archived: '#9ca3af',
};

/** Align slug field with Select compact trigger: subtle chrome, ~32px row height. */
const FLUX_HEADER_SLUG_INPUT =
  'min-h-[32px] flex-1 min-w-[100px] max-w-[220px] rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-xs font-instrument-semibold text-white';

const HEADER_BUTTON_ROW_CLASS = 'min-h-[32px] justify-center';

export type FluxProspectEditorHeaderProps = {
  onBack: () => void;
  prospect: FluxProspectRow;
  campaign: FluxCampaignRow | null;
  fluxGenerateConfigured: boolean;
  generateWiringDismissed: boolean;
  onDismissGenerateWiring: () => void;
  page: FluxProspectPageRow | null;
  hasPageConfig: boolean;
  draftSlug: string;
  onDraftSlugChange: (value: string) => void;
  onSlugBlur: () => void;
  slugChecking: boolean;
  slugCheckAvailable: boolean | null;
  slugDirty: boolean;
  /** Single save for prospect row, slug, and page draft (or subset when dirty). */
  onSaveAll: () => void;
  saveAllDisabled: boolean;
  saveAllBusy: boolean;
  onCopyUrl: () => void;
  regenerating: boolean;
  onRegenerate: () => void;
  statuses: readonly FluxPageStatus[];
  statusUpdating: boolean;
  onStatusChange: (status: FluxPageStatus) => void;
  /** When true, show a button to open prospect CRM details (e.g. before page exists). */
  showProspectDetailsCta: boolean;
  onOpenProspectDetails?: () => void;
};

export function FluxProspectEditorHeader({
  onBack,
  prospect,
  campaign,
  fluxGenerateConfigured,
  generateWiringDismissed,
  onDismissGenerateWiring,
  page,
  hasPageConfig,
  draftSlug,
  onDraftSlugChange,
  onSlugBlur,
  slugChecking,
  slugCheckAvailable,
  slugDirty,
  onSaveAll,
  saveAllDisabled,
  saveAllBusy,
  onCopyUrl,
  regenerating,
  onRegenerate,
  statuses,
  statusUpdating,
  onStatusChange,
  showProspectDetailsCta,
  onOpenProspectDetails,
}: FluxProspectEditorHeaderProps) {
  const [backHovered, setBackHovered] = useState(false);

  const liveBlocked = Boolean(
    page && !canPublishFluxProspectPage(page.page_config),
  );

  const isItemDisabled = useCallback(
    (s: FluxPageStatus) => s === 'live' && liveBlocked,
    [liveBlocked],
  );

  const getItemLabel = useCallback(
    (s: FluxPageStatus) => ({
      primary: s.charAt(0).toUpperCase() + s.slice(1),
      secondary: s === 'live' && liveBlocked ? 'Complete competitor audit first' : undefined,
    }),
    [liveBlocked],
  );

  const statusItems = useMemo(() => [...statuses], [statuses]);

  const prospectTooltipDetails = useMemo(() => {
    const companyRole = [prospect.company, prospect.role].filter(Boolean).join(' · ');
    return { companyRole, campaignName: campaign?.name ?? null };
  }, [prospect.company, prospect.role, campaign?.name]);

  const hasProspectTooltip =
    Boolean(prospectTooltipDetails.companyRole) || Boolean(prospectTooltipDetails.campaignName);

  const prospectTooltipContent = useMemo(
    () => (
      <View className="max-w-[280px] gap-1">
        {prospectTooltipDetails.companyRole ? (
          <Text className="text-gray-200 font-instrument text-xs leading-snug">
            {prospectTooltipDetails.companyRole}
          </Text>
        ) : null}
        {prospectTooltipDetails.campaignName ? (
          <Text className="text-gray-400 font-instrument text-[11px] leading-snug">
            Campaign: {prospectTooltipDetails.campaignName}
          </Text>
        ) : null}
      </View>
    ),
    [prospectTooltipDetails],
  );

  const prospectNameEl = (
    <View className="max-w-[280px] min-w-0 shrink">
      <Text
        className="text-xs font-instrument-semibold text-white"
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {prospect.name}
      </Text>
    </View>
  );

  return (
    <View className="border-b border-[#2A2A2A] bg-[#141414] px-3 pt-1.5 pb-2 gap-2">
      <View className="w-full flex-row flex-wrap items-center gap-x-2 gap-y-2">
        <Pressable
          onPress={onBack}
          onHoverIn={() => setBackHovered(true)}
          onHoverOut={() => setBackHovered(false)}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
          className="shrink-0 -ml-1 rounded-md px-1.5 py-1.5"
        >
          <Text
            className={`text-xs font-instrument-medium ${backHovered ? 'text-gray-200' : 'text-gray-400'}`}
          >
            ← Back
          </Text>
        </Pressable>

        {hasProspectTooltip ? (
          <Tooltip content={prospectTooltipContent} placement="bottom">
            {prospectNameEl}
          </Tooltip>
        ) : (
          prospectNameEl
        )}

        {page ? (
          <View className="min-w-0 shrink flex-row flex-wrap items-center gap-x-1.5 gap-y-1">
            <Text className="shrink-0 text-xs font-instrument text-gray-400">/p/</Text>
            <TextInput
              className={FLUX_HEADER_SLUG_INPUT}
              value={draftSlug}
              onChangeText={onDraftSlugChange}
              onBlur={onSlugBlur}
              placeholder="your-page-slug"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {slugChecking ? (
              <ActivityIndicator size="small" color="#6b7280" />
            ) : slugCheckAvailable === true ? (
              <Text className="shrink-0 text-[11px] font-instrument text-green-400">Available</Text>
            ) : slugCheckAvailable === false ? (
              <Text className="shrink-0 text-[11px] font-instrument text-red-400">Taken</Text>
            ) : null}
            {slugDirty ? (
              <Text className="shrink-0 text-[11px] font-instrument text-amber-200/90">Save to apply slug</Text>
            ) : null}
            <View className="shrink-0">
              <Text className="text-xs font-instrument text-gray-500">
                {page.view_count} views
              </Text>
              {page.last_viewed_at ? (
                <Text className="text-[11px] font-instrument text-gray-600">
                  Last: {new Date(page.last_viewed_at).toLocaleDateString()}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        <View className="min-h-[1px] min-w-[12px] flex-1 basis-0 grow" />

        <View className={`${fluxPanelActionRowClass} shrink-0 flex-wrap`}>
          <Button
            size="xs"
            onPress={onSaveAll}
            disabled={saveAllDisabled}
            className={HEADER_BUTTON_ROW_CLASS}
          >
            {saveAllBusy ? 'Saving…' : 'Save'}
          </Button>
          {page ? (
            <>
              <Button
                size="xs"
                onPress={onRegenerate}
                disabled={regenerating}
                className={HEADER_BUTTON_ROW_CLASS}
              >
                {regenerating ? 'Generating…' : 'Regenerate'}
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onPress={onCopyUrl}
                className={HEADER_BUTTON_ROW_CLASS}
              >
                Copy URL
              </Button>
              <View className="min-w-[128px] max-w-[200px]">
                <Select<FluxPageStatus>
                  searchable={false}
                  items={statusItems}
                  getItemId={(s) => s}
                  getItemLabel={getItemLabel}
                  getItemColor={(s) => STATUS_ITEM_COLORS[s]}
                  value={page.status}
                  onChange={(id) => void onStatusChange(id as FluxPageStatus)}
                  disabled={statusUpdating}
                  isItemDisabled={isItemDisabled}
                  placeholder="Status"
                  size="compact"
                  panelSize="compact"
                  noMargin
                  listMaxHeight={240}
                />
              </View>
            </>
          ) : null}
          {showProspectDetailsCta && onOpenProspectDetails ? (
            <Button
              size="xs"
              variant="secondary"
              onPress={onOpenProspectDetails}
              className={HEADER_BUTTON_ROW_CLASS}
            >
              Prospect details
            </Button>
          ) : null}
        </View>
      </View>

      {!fluxGenerateConfigured && !generateWiringDismissed ? (
        <View className="border border-red-500/40 bg-red-500/10 rounded-lg p-2.5 gap-2">
          <View className="flex-row flex-wrap items-start justify-between gap-2">
            <Text className="text-red-100 text-xs font-instrument-semibold shrink">Generate is not wired</Text>
            <Button
              size="xs"
              variant="secondary"
              onPress={onDismissGenerateWiring}
              className={HEADER_BUTTON_ROW_CLASS}
            >
              Dismiss
            </Button>
          </View>
          <Text className="text-red-100/90 text-[11px] font-instrument leading-4">
            The app needs the Flux Lambda Function URL. After `npx ampx sandbox` or deploy, your root{' '}
            <Text className="font-mono">amplify_outputs.json</Text> should include{' '}
            <Text className="font-mono">custom.fluxGenerateUrl</Text>. Restart Expo if you just generated that file.
            Alternatively set <Text className="font-mono">EXPO_PUBLIC_FLUX_GENERATE_URL</Text> in{' '}
            <Text className="font-mono">.env.local</Text> to that URL. The Lambda also needs secrets:{' '}
            <Text className="font-mono">OPENROUTER_API_KEY</Text>, <Text className="font-mono">SUPABASE_SECRET_KEY</Text>.
          </Text>
        </View>
      ) : null}

      {page?.status === 'live' && !hasRenderableFluxPageConfig(page.page_config) ? (
        <View className={fluxPanelAlertCardClass}>
          <Text className="text-amber-100 text-sm font-instrument leading-5">
            Status is <Text className="font-instrument-semibold">live</Text> but there is no generated page yet (empty
            config). The public URL will not show content until you run Generate or Regenerate, or you can switch back to
            draft.
          </Text>
        </View>
      ) : null}

      {page?.status === 'live' &&
      hasRenderableFluxPageConfig(page.page_config) &&
      !canPublishFluxProspectPage(page.page_config) ? (
        <View className={fluxPanelAlertCardClass}>
          <Text className="text-amber-100 text-sm font-instrument leading-5">
            Status is <Text className="font-instrument-semibold">live</Text> but a competitor ad audit block is not
            complete. Open the <Text className="font-instrument-semibold">Audit</Text> tab to finish the audit (or
            switch to draft) so the public page matches your quality bar.
          </Text>
        </View>
      ) : null}

      {!hasPageConfig && page ? (
        <View className={`${fluxPanelSectionCardClass} p-3 flex-row flex-wrap items-center justify-between gap-2`}>
          <Text className="text-gray-400 text-xs font-instrument">Page not yet generated.</Text>
          <Button
            size="xs"
            onPress={onRegenerate}
            disabled={regenerating}
            className={HEADER_BUTTON_ROW_CLASS}
          >
            {regenerating ? 'Generating…' : 'Generate now'}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
