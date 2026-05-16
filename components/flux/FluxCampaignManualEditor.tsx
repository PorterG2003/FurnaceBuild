import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import {
  BriefcaseIcon,
  FolderIcon,
  MegaphoneIcon,
  PencilSquareIcon,
  RectangleStackIcon,
  SwatchIcon,
  UserGroupIcon,
  UserIcon,
} from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import type { FluxBrowserTabItem } from '@/components/flux/FluxBrowserTabBar';
import { FluxFontFamilyPicker } from '@/components/flux/FluxFontFamilyPicker';
import { FluxHexColorField } from '@/components/flux/FluxHexColorField';
import { FluxTemplateBlocksDraggableList } from '@/components/flux/FluxTemplateBlocksDraggableList';
import {
  FLUX_ALL_BLOCK_TYPES,
  FLUX_MANUAL_BLOCK_TYPE_LABELS,
  fluxManualBlockSummary,
  renderFluxManualBlockEditor,
} from '@/components/flux/FluxManualBlockEditor';
import { defaultFluxPreviewProspect } from '@/lib/flux/fluxCampaignPreview';
import type { FluxPageThemeMode } from '@/lib/flux/fluxBrandingPolicy';
import { mergeBrandProfileWithWebsiteIntel } from '@/lib/flux/mergeBrandProfileWithWebsiteIntel';
import { runWebsiteIntelligenceScrapePoll } from '@/lib/flux/websiteIntelScrapePoll';
import {
  FLUX_BLOCK_STYLE_PRESET_OPTIONS,
  type FluxBlockStylePreset,
} from '@/lib/flux/fluxPresentationTokens';
import {
  fluxPanelActionRowClass,
  fluxPanelHexContainerRowClass,
  fluxPanelInputClass,
  fluxPanelInputFieldClass,
  fluxPanelInputMultilineClass,
  fluxPanelInputTallMultilineClass,
  fluxPanelLabelClass,
  fluxPanelSubsectionLabelClass,
} from '@/lib/flux/fluxEditorPanelClasses';
import { useFluxEditorPanelTwoColumns } from '@/lib/flux/useFluxEditorPanelTwoColumns';
import {
  FLUX_CONSTRAINTS_SKELETON,
  parseFluxCopySlots,
} from '@/lib/flux/fluxCampaignMethodologyQa';
import type { Block, ContentAsset, FluxPreviewProspectInput, FluxProspectRow } from '@/lib/flux/types';
import type {
  FluxCampaignEditorAction,
  FluxCampaignEditorState,
} from '@/lib/flux/editor/reducer';

export const FLUX_CAMPAIGN_MANUAL_TAB = {
  campaign: 'campaign',
  seller: 'seller',
  branding: 'branding',
  sample: 'sample',
  blocks: 'blocks',
  assets: 'assets',
  spec: 'spec',
  prospects: 'prospects',
} as const;

export const FLUX_CAMPAIGN_MANUAL_BROWSER_TABS: FluxBrowserTabItem[] = [
  { id: FLUX_CAMPAIGN_MANUAL_TAB.campaign, label: 'Campaign', icon: MegaphoneIcon },
  { id: FLUX_CAMPAIGN_MANUAL_TAB.seller, label: 'Seller', icon: BriefcaseIcon },
  { id: FLUX_CAMPAIGN_MANUAL_TAB.branding, label: 'Branding', icon: SwatchIcon },
  { id: FLUX_CAMPAIGN_MANUAL_TAB.sample, label: 'Sample', icon: UserIcon },
  { id: FLUX_CAMPAIGN_MANUAL_TAB.blocks, label: 'Blocks', icon: RectangleStackIcon },
  { id: FLUX_CAMPAIGN_MANUAL_TAB.assets, label: 'Assets', icon: FolderIcon },
  { id: FLUX_CAMPAIGN_MANUAL_TAB.spec, label: 'Spec', icon: PencilSquareIcon },
  { id: FLUX_CAMPAIGN_MANUAL_TAB.prospects, label: 'Prospects', icon: UserGroupIcon },
];

interface FluxCampaignManualEditorProps {
  editor: FluxCampaignEditorState;
  dispatch: React.Dispatch<FluxCampaignEditorAction>;
  prospects: FluxProspectRow[];
  onNavigateNewProspect: () => void;
  onNavigateProspect: (prospectId: string) => void;
  /** Parent-owned tab id (must be one of `FLUX_CAMPAIGN_MANUAL_TAB`). */
  activeTab: string;
}

export function FluxCampaignManualEditor({
  editor,
  dispatch,
  prospects,
  onNavigateNewProspect,
  onNavigateProspect,
  activeTab,
}: FluxCampaignManualEditorProps) {
  const pairFieldColumns = useFluxEditorPanelTwoColumns();

  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetTitle, setAssetTitle] = useState('');
  const [assetBody, setAssetBody] = useState('');
  const [assetMetric, setAssetMetric] = useState('');
  const [assetAttribution, setAssetAttribution] = useState('');
  const [assetImageUrl, setAssetImageUrl] = useState('');
  const [assetType, setAssetType] = useState<'case_study' | 'testimonial' | 'stat'>('case_study');
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [sellerScrapeBusy, setSellerScrapeBusy] = useState(false);
  const [editAssetTitle, setEditAssetTitle] = useState('');
  const [editAssetBody, setEditAssetBody] = useState('');
  const [editAssetMetric, setEditAssetMetric] = useState('');
  const [editAssetAttribution, setEditAssetAttribution] = useState('');
  const [editAssetImageUrl, setEditAssetImageUrl] = useState('');
  const [editAssetType, setEditAssetType] = useState<'case_study' | 'testimonial' | 'stat'>('case_study');

  const copySlots = useMemo(() => parseFluxCopySlots(editor.copySlots), [editor.copySlots]);

  const patchPreviewProspect = (patch: Partial<FluxPreviewProspectInput>) => {
    dispatch({ type: 'preview.patchProspect', patch });
  };

  const handleSellerWebsiteScrape = useCallback(async () => {
    const url = editor.sellerProfile.websiteUrl.trim();
    if (!url) {
      Alert.alert('Website URL required', 'Enter your company website first.');
      return;
    }
    setSellerScrapeBusy(true);
    try {
      const result = await runWebsiteIntelligenceScrapePoll({ url, force: true });
      if (!result.ok) {
        Alert.alert('Website scrape failed', result.message);
        return;
      }
      if (!result.snapshot) {
        Alert.alert('Website intel', result.message || 'No usable intel returned.');
        return;
      }
      const snap = result.snapshot;
      dispatch({ type: 'seller.setIntel', value: snap });
      dispatch({
        type: 'seller.setMeta',
        patch: {
          websiteDomainKey: snap.normalized_domain_key ?? null,
          foundryCompanyId: snap.company_id ?? null,
          websiteIntelAutoFilledAt: new Date().toISOString(),
        },
      });
      const merged = mergeBrandProfileWithWebsiteIntel(editor.sellerProfile.brand_profile ?? undefined, snap);
      dispatch({
        type: 'seller.patchBrand',
        patch: {
          primaryColor: merged.primaryColor,
          accentColor: merged.accentColor,
          fontFamily: merged.fontFamily,
          logoUrl: merged.logoUrl,
          blockStylePreset: merged.blockStylePreset,
        },
      });
      const brandName = snap.extracted_profile?.brand_name;
      if (brandName && !editor.sellerProfile.displayName.trim()) {
        dispatch({ type: 'seller.patchProfile', patch: { displayName: brandName } });
      }
    } finally {
      setSellerScrapeBusy(false);
    }
  }, [dispatch, editor.sellerProfile.brand_profile, editor.sellerProfile.displayName, editor.sellerProfile.websiteUrl]);

  const setPageTheme = (pageTheme: FluxPageThemeMode) => {
    dispatch({ type: 'branding.setPolicy', value: { v: 1, pageTheme } });
  };

  const patchPreviewBrand = (patch: {
    primaryColor?: string;
    accentColor?: string;
    fontFamily?: string;
    logoUrl?: string;
    blockStylePreset?: FluxBlockStylePreset;
  }) => {
    dispatch({ type: 'preview.patchBrand', patch });
  };

  const addBlock = (type: (typeof FLUX_ALL_BLOCK_TYPES)[number]) => {
    dispatch({ type: 'block.add', blockType: type });
  };

  const removeBlock = (blockId: string) => {
    dispatch({ type: 'block.remove', blockId });
  };

  const updateBlockProps = (blockId: string, props: Record<string, unknown>) => {
    dispatch({ type: 'block.updateProps', blockId, props });
  };

  const updateBlockScrollTag = (blockId: string, scrollTag: string | undefined) => {
    dispatch({ type: 'block.setScrollTag', blockId, scrollTag: scrollTag?.trim() ? scrollTag.trim() : null });
  };

  const addAsset = () => {
    const asset: ContentAsset = {
      id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: assetType,
      title: assetTitle,
      body: assetBody,
      metric: assetMetric || undefined,
      attribution: assetAttribution || undefined,
      imageUrl: assetImageUrl.trim() ? assetImageUrl.trim() : undefined,
    };
    dispatch({ type: 'asset.add', asset });
    setShowAssetForm(false);
    setAssetTitle('');
    setAssetBody('');
    setAssetMetric('');
    setAssetAttribution('');
    setAssetImageUrl('');
  };

  const removeAsset = (assetId: string) => {
    dispatch({ type: 'asset.remove', assetId });
    if (editingAssetId === assetId) setEditingAssetId(null);
  };

  const beginEditAsset = (asset: ContentAsset) => {
    setShowAssetForm(false);
    setEditingAssetId(asset.id);
    setEditAssetTitle(asset.title);
    setEditAssetBody(asset.body);
    setEditAssetMetric(asset.metric ?? '');
    setEditAssetAttribution(asset.attribution ?? '');
    setEditAssetImageUrl(asset.imageUrl ?? '');
    setEditAssetType(asset.type);
  };

  const cancelEditAsset = () => {
    setEditingAssetId(null);
  };

  const saveEditAsset = () => {
    if (!editingAssetId) return;
    dispatch({
      type: 'asset.update',
      assetId: editingAssetId,
      patch: {
        type: editAssetType,
        title: editAssetTitle,
        body: editAssetBody,
        metric: editAssetMetric.trim() ? editAssetMetric.trim() : null,
        attribution: editAssetAttribution.trim() ? editAssetAttribution.trim() : null,
        imageUrl: editAssetImageUrl.trim() ? editAssetImageUrl.trim() : null,
      },
    });
    setEditingAssetId(null);
  };

  return (
    <View className="flex-1 min-w-0 self-stretch">
        {activeTab === FLUX_CAMPAIGN_MANUAL_TAB.campaign ? (
          <View className="gap-1.5">
        <TextInput
          className="text-white text-base font-instrument-semibold bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-2.5 py-2 mb-1.5"
          value={editor.name}
          onChangeText={(value) => dispatch({ type: 'campaign.setName', value })}
          placeholder="Campaign name"
          placeholderTextColor="#555"
        />
        <TextInput
          className="text-gray-300 text-xs font-instrument bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg px-2.5 py-2 min-h-[72px]"
          value={editor.offerDescription}
          onChangeText={(value) => dispatch({ type: 'campaign.setOfferDescription', value })}
          placeholder="Who this campaign is for and what the reader should get from it"
          placeholderTextColor="#555"
          multiline
        />
          </View>
        ) : activeTab === FLUX_CAMPAIGN_MANUAL_TAB.seller ? (
          <View className="gap-1.5">
        <Text className="text-gray-500 text-[11px] font-instrument leading-4 mb-1.5">
          Your company (agency or client). Separate from the sample recipient below.
        </Text>
        {pairFieldColumns ? (
          <View className="flex-row gap-2 flex-wrap mb-1.5">
            <View className="flex-1 min-w-[120px]">
              <Text className={fluxPanelLabelClass}>Display name</Text>
              <TextInput
                className={`${fluxPanelInputFieldClass} w-full`}
                value={editor.sellerProfile.displayName}
                onChangeText={(value) => dispatch({ type: 'seller.patchProfile', patch: { displayName: value } })}
                placeholder="Your company name"
                placeholderTextColor="#555"
              />
            </View>
            <View className="flex-1 min-w-[120px]">
              <Text className={fluxPanelLabelClass}>Tagline</Text>
              <TextInput
                className={`${fluxPanelInputFieldClass} w-full`}
                value={editor.sellerProfile.tagline}
                onChangeText={(value) => dispatch({ type: 'seller.patchProfile', patch: { tagline: value } })}
                placeholder="One-line positioning"
                placeholderTextColor="#555"
              />
            </View>
          </View>
        ) : (
          <>
            <Text className={fluxPanelLabelClass}>Display name</Text>
            <TextInput
              className={fluxPanelInputClass}
              value={editor.sellerProfile.displayName}
              onChangeText={(value) => dispatch({ type: 'seller.patchProfile', patch: { displayName: value } })}
              placeholder="Your company name"
              placeholderTextColor="#555"
            />
            <Text className={fluxPanelLabelClass}>Tagline</Text>
            <TextInput
              className={fluxPanelInputClass}
              value={editor.sellerProfile.tagline}
              onChangeText={(value) => dispatch({ type: 'seller.patchProfile', patch: { tagline: value } })}
              placeholder="One-line positioning"
              placeholderTextColor="#555"
            />
          </>
        )}
        <Text className={fluxPanelLabelClass}>Website URL</Text>
        <TextInput
          className={fluxPanelInputClass}
          value={editor.sellerProfile.websiteUrl}
          onChangeText={(value) => dispatch({ type: 'seller.patchProfile', patch: { websiteUrl: value } })}
          placeholder="https://…"
          placeholderTextColor="#555"
          autoCapitalize="none"
        />
        <View className={`${fluxPanelActionRowClass} mb-2`}>
          <Button
            size="2xs"
            variant="secondary"
            onPress={() => void handleSellerWebsiteScrape()}
            disabled={sellerScrapeBusy}
          >
            {sellerScrapeBusy ? 'Scraping…' : 'Refresh from website'}
          </Button>
          {sellerScrapeBusy ? <ActivityIndicator color="#9ca3af" /> : null}
        </View>
        <Text className={fluxPanelSubsectionLabelClass}>Brand</Text>
        {pairFieldColumns ? (
          <View className="flex-row gap-2 flex-wrap mb-1.5">
            <View className="flex-1 min-w-[140px]">
              <Text className={fluxPanelLabelClass}>Primary</Text>
              <FluxHexColorField
                value={editor.sellerProfile.brand_profile?.primaryColor ?? '#4f46e5'}
                onChange={(primaryColor) =>
                  dispatch({ type: 'seller.patchBrand', patch: { primaryColor } })
                }
                containerClassName={fluxPanelHexContainerRowClass}
              />
            </View>
            <View className="flex-1 min-w-[140px]">
              <Text className={fluxPanelLabelClass}>Accent</Text>
              <FluxHexColorField
                value={editor.sellerProfile.brand_profile?.accentColor ?? ''}
                onChange={(hex) => dispatch({ type: 'seller.patchBrand', patch: { accentColor: hex || undefined } })}
                allowEmpty
                containerClassName={fluxPanelHexContainerRowClass}
              />
            </View>
          </View>
        ) : (
          <>
            <Text className={fluxPanelLabelClass}>Primary</Text>
            <FluxHexColorField
              value={editor.sellerProfile.brand_profile?.primaryColor ?? '#4f46e5'}
              onChange={(primaryColor) =>
                dispatch({ type: 'seller.patchBrand', patch: { primaryColor } })
              }
            />
            <Text className={fluxPanelLabelClass}>Accent</Text>
            <FluxHexColorField
              value={editor.sellerProfile.brand_profile?.accentColor ?? ''}
              onChange={(hex) => dispatch({ type: 'seller.patchBrand', patch: { accentColor: hex || undefined } })}
              allowEmpty
            />
          </>
        )}
        <Text className={fluxPanelLabelClass}>Font</Text>
        <FluxFontFamilyPicker
          value={editor.sellerProfile.brand_profile?.fontFamily}
          onChange={(fontFamily) => dispatch({ type: 'seller.patchBrand', patch: { fontFamily } })}
        />
        <Text className={fluxPanelLabelClass}>Logo URL</Text>
        <TextInput
          className={fluxPanelInputFieldClass}
          value={editor.sellerProfile.brand_profile?.logoUrl ?? ''}
          onChangeText={(value) => dispatch({ type: 'seller.patchBrand', patch: { logoUrl: value || undefined } })}
          placeholder="https://…"
          placeholderTextColor="#555"
          autoCapitalize="none"
        />
        {editor.sellerProfile.website_intel ? (
          <View className="mb-2">
            <Text className="text-gray-400 text-xs font-instrument">Seller website intel</Text>
            <Text className="text-gray-500 text-xs font-instrument mt-1">
              {editor.sellerProfile.website_intel.normalized_domain_key}
              {editor.sellerProfile.website_intel.hit ? ' · hit' : ''}
            </Text>
            <Pressable
              onPress={() => {
                dispatch({ type: 'seller.setIntel', value: null });
                dispatch({ type: 'seller.setMeta', patch: { websiteIntelAutoFilledAt: null } });
              }}
              className="mt-2"
            >
              <Text className="text-red-400 text-xs font-instrument">Clear intel snapshot</Text>
            </Pressable>
          </View>
        ) : null}
          </View>
        ) : activeTab === FLUX_CAMPAIGN_MANUAL_TAB.branding ? (
          <View className="gap-1.5">
        <Text className="text-gray-500 text-[11px] font-instrument leading-4 mb-1.5">
          How seller and recipient brands combine in the live preview theme.
        </Text>
        <View className="flex-row flex-wrap gap-1.5">
          {(['prospect', 'seller', 'merge'] as const).map((mode) => {
            const selected = editor.brandingPolicy.pageTheme === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => setPageTheme(mode)}
                className={`px-2 py-1.5 rounded-md border ${
                  selected ? 'border-orange-500 bg-orange-500/15' : 'border-[#333] bg-[#222]'
                }`}
              >
                <Text className={`text-xs font-instrument-semibold ${selected ? 'text-orange-200' : 'text-gray-300'}`}>
                  {mode === 'prospect' ? 'Recipient' : mode === 'seller' ? 'Seller' : 'Merge'}
                </Text>
              </Pressable>
            );
          })}
        </View>
          </View>
        ) : activeTab === FLUX_CAMPAIGN_MANUAL_TAB.sample ? (
          <View className="gap-1.5">
        <View className="border border-[#2A2A2A] rounded-lg p-2 bg-[#1A1A1A] gap-1">
          <Text className="text-gray-500 text-[11px] font-instrument leading-4 mb-1">
            Realistic lead for the studio preview. Theme updates instantly; copy/structure may need a fresh AI rerun.
          </Text>
          <Text className={fluxPanelSubsectionLabelClass}>Contact</Text>
          {pairFieldColumns ? (
            <View className="flex-row gap-2 flex-wrap mb-1.5">
              <View className="flex-1 min-w-[120px]">
                <Text className={fluxPanelLabelClass}>Contact name</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={editor.previewProspect.name}
                  onChangeText={(value) => patchPreviewProspect({ name: value })}
                  placeholder="Jane Smith"
                  placeholderTextColor="#555"
                />
              </View>
              <View className="flex-1 min-w-[120px]">
                <Text className={fluxPanelLabelClass}>Company</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={editor.previewProspect.company}
                  onChangeText={(value) => patchPreviewProspect({ company: value })}
                  placeholder="Acme Corp"
                  placeholderTextColor="#555"
                />
              </View>
            </View>
          ) : (
            <>
              <Text className={fluxPanelLabelClass}>Contact name</Text>
              <TextInput
                className={fluxPanelInputClass}
                value={editor.previewProspect.name}
                onChangeText={(value) => patchPreviewProspect({ name: value })}
                placeholder="Jane Smith"
                placeholderTextColor="#555"
              />
              <Text className={fluxPanelLabelClass}>Company</Text>
              <TextInput
                className={fluxPanelInputClass}
                value={editor.previewProspect.company}
                onChangeText={(value) => patchPreviewProspect({ company: value })}
                placeholder="Acme Corp"
                placeholderTextColor="#555"
              />
            </>
          )}
          {pairFieldColumns ? (
            <View className="flex-row gap-2 flex-wrap mb-1.5">
              <View className="flex-1 min-w-[120px]">
                <Text className={fluxPanelLabelClass}>Role</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={editor.previewProspect.role ?? ''}
                  onChangeText={(value) => patchPreviewProspect({ role: value })}
                  placeholder="VP of Sales"
                  placeholderTextColor="#555"
                />
              </View>
              <View className="flex-1 min-w-[120px]">
                <Text className={fluxPanelLabelClass}>Company URL</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={editor.previewProspect.url ?? ''}
                  onChangeText={(value) => patchPreviewProspect({ url: value })}
                  placeholder="https://acme.com"
                  placeholderTextColor="#555"
                  autoCapitalize="none"
                />
              </View>
            </View>
          ) : (
            <>
              <Text className={fluxPanelLabelClass}>Role</Text>
              <TextInput
                className={fluxPanelInputClass}
                value={editor.previewProspect.role ?? ''}
                onChangeText={(value) => patchPreviewProspect({ role: value })}
                placeholder="VP of Sales"
                placeholderTextColor="#555"
              />
              <Text className={fluxPanelLabelClass}>Company URL</Text>
              <TextInput
                className={fluxPanelInputClass}
                value={editor.previewProspect.url ?? ''}
                onChangeText={(value) => patchPreviewProspect({ url: value })}
                placeholder="https://acme.com"
                placeholderTextColor="#555"
                autoCapitalize="none"
              />
            </>
          )}
          {pairFieldColumns ? (
            <View className="flex-row gap-2 flex-wrap mb-1.5">
              <View className="flex-1 min-w-[120px]">
                <Text className={fluxPanelLabelClass}>Industry</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={editor.previewProspect.industry ?? ''}
                  onChangeText={(value) => patchPreviewProspect({ industry: value })}
                  placeholder="SaaS"
                  placeholderTextColor="#555"
                />
              </View>
              <View className="flex-1 min-w-[120px]">
                <Text className={fluxPanelLabelClass}>Company size</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={editor.previewProspect.company_size ?? ''}
                  onChangeText={(value) => patchPreviewProspect({ company_size: value })}
                  placeholder="50-200"
                  placeholderTextColor="#555"
                />
              </View>
            </View>
          ) : (
            <>
              <Text className={fluxPanelLabelClass}>Industry</Text>
              <TextInput
                className={fluxPanelInputClass}
                value={editor.previewProspect.industry ?? ''}
                onChangeText={(value) => patchPreviewProspect({ industry: value })}
                placeholder="SaaS"
                placeholderTextColor="#555"
              />
              <Text className={fluxPanelLabelClass}>Company size</Text>
              <TextInput
                className={fluxPanelInputClass}
                value={editor.previewProspect.company_size ?? ''}
                onChangeText={(value) => patchPreviewProspect({ company_size: value })}
                placeholder="50-200"
                placeholderTextColor="#555"
              />
            </>
          )}
          <Text className={fluxPanelLabelClass}>Email notes</Text>
          <TextInput
            className={fluxPanelInputMultilineClass}
            value={editor.previewProspect.email_notes ?? ''}
            onChangeText={(value) => patchPreviewProspect({ email_notes: value })}
            placeholder="What does this lead care about right now?"
            placeholderTextColor="#555"
            multiline
            textAlignVertical="top"
          />
          {editor.previewProspect.website_intel ? (
            <View className="border border-[#333] rounded-lg p-3 mb-3 gap-1">
              <Text className="text-gray-500 text-[10px] uppercase tracking-wider font-instrument-semibold">
                Website intel (preview)
              </Text>
              <Text className="text-gray-300 text-xs font-instrument">
                {editor.previewProspect.website_intel.normalized_domain_key}
                {editor.previewProspect.website_intel.hit ? ' · hit' : ''}
                {editor.previewProspect.website_intel.stale ? ' · stale' : ''}
              </Text>
              {editor.previewProspect.website_intel.extracted_profile?.business_summary ? (
                <Text className="text-gray-400 text-xs font-instrument mt-1" numberOfLines={3}>
                  {editor.previewProspect.website_intel.extracted_profile.business_summary}
                </Text>
              ) : null}
            </View>
          ) : null}
          {editor.previewProspect.website_intel ? (
            <Pressable
              className="border border-[#444] rounded-lg px-3 py-2 mb-3 self-start"
              onPress={() => patchPreviewProspect({ website_intel: null })}
            >
              <Text className="text-gray-400 text-xs font-instrument">Clear website intel</Text>
            </Pressable>
          ) : null}
          <Text className={fluxPanelSubsectionLabelClass}>Brand</Text>
          {pairFieldColumns ? (
            <View className="flex-row gap-2 flex-wrap mb-1.5">
              <View className="flex-1 min-w-[140px]">
                <Text className={fluxPanelLabelClass}>Primary color</Text>
                <FluxHexColorField
                  value={editor.previewProspect.brand_profile?.primaryColor ?? '#4f46e5'}
                  onChange={(primaryColor) => patchPreviewBrand({ primaryColor })}
                  placeholder="#4f46e5"
                  fallbackHex="#4f46e5"
                  containerClassName={fluxPanelHexContainerRowClass}
                />
              </View>
              <View className="flex-1 min-w-[140px]">
                <Text className={fluxPanelLabelClass}>Accent (optional)</Text>
                <FluxHexColorField
                  value={editor.previewProspect.brand_profile?.accentColor ?? ''}
                  onChange={(hex) => patchPreviewBrand({ accentColor: hex || undefined })}
                  allowEmpty
                  placeholder="#10b981"
                  fallbackHex="#10b981"
                  containerClassName={fluxPanelHexContainerRowClass}
                />
              </View>
            </View>
          ) : (
            <>
              <Text className={fluxPanelLabelClass}>Primary color</Text>
              <FluxHexColorField
                value={editor.previewProspect.brand_profile?.primaryColor ?? '#4f46e5'}
                onChange={(primaryColor) => patchPreviewBrand({ primaryColor })}
                placeholder="#4f46e5"
                fallbackHex="#4f46e5"
              />
              <Text className={fluxPanelLabelClass}>Accent (optional)</Text>
              <FluxHexColorField
                value={editor.previewProspect.brand_profile?.accentColor ?? ''}
                onChange={(hex) => patchPreviewBrand({ accentColor: hex || undefined })}
                allowEmpty
                placeholder="#10b981"
                fallbackHex="#10b981"
              />
            </>
          )}
          <Text className={fluxPanelLabelClass}>Font</Text>
          <FluxFontFamilyPicker
            value={editor.previewProspect.brand_profile?.fontFamily}
            onChange={(fontFamily) => patchPreviewBrand({ fontFamily })}
          />
          <Text className={fluxPanelLabelClass}>Style preset</Text>
          <View className="gap-1.5 mb-1.5">
            {FLUX_BLOCK_STYLE_PRESET_OPTIONS.map((option) => {
              const selected = (editor.previewProspect.brand_profile?.blockStylePreset ?? 'classic') === option.id;
              return (
                <Pressable
                  key={option.id}
                  className={`rounded-md border px-2 py-1.5 ${
                    selected ? 'border-indigo-500 bg-indigo-500/15' : 'border-[#333] bg-[#222]'
                  }`}
                  onPress={() => patchPreviewBrand({ blockStylePreset: option.id })}
                >
                  <Text className="text-white text-xs font-instrument-semibold">{option.label}</Text>
                  <Text className="text-gray-400 text-[11px] font-instrument mt-0.5 leading-4">{option.description}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className={fluxPanelLabelClass}>Logo URL (optional)</Text>
          <TextInput
            className={fluxPanelInputFieldClass}
            value={editor.previewProspect.brand_profile?.logoUrl ?? ''}
            onChangeText={(value) => patchPreviewBrand({ logoUrl: value || undefined })}
            placeholder="https://…"
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
          {prospects.length > 0 ? (
            <Button
              size="2xs"
              variant="secondary"
              onPress={() => {
                const sample = prospects[0];
                dispatch({
                  type: 'preview.setProspect',
                  value: {
                    name: sample.name,
                    company: sample.company,
                    role: sample.role ?? '',
                    url: sample.url ?? '',
                    industry: sample.industry ?? '',
                    company_size: sample.company_size ?? '',
                    email_notes: sample.email_notes ?? '',
                    brand_profile:
                      sample.brand_profile ?? defaultFluxPreviewProspect().brand_profile,
                    website_intel: sample.website_intel_snapshot ?? null,
                  },
                });
              }}
            >
              Fill from first prospect ({prospects[0].name})
            </Button>
          ) : null}
        </View>
          </View>
        ) : activeTab === FLUX_CAMPAIGN_MANUAL_TAB.blocks ? (
          <View className="gap-1.5">
        {editor.blocks.length === 0 ? (
          <View className="border border-[#2A2A2A] rounded-lg p-2">
            <Text className="text-gray-400 text-xs font-instrument text-center">
              No blocks yet. Let chat build them or add one below.
            </Text>
          </View>
        ) : (
          <FluxTemplateBlocksDraggableList
            blocks={editor.blocks}
            blockTypeLabels={FLUX_MANUAL_BLOCK_TYPE_LABELS}
            blockSummary={fluxManualBlockSummary}
            editingBlockId={editor.editingBlockId}
            onToggleEditing={(blockId: string) => dispatch({ type: 'ui.toggleEditingBlock', blockId })}
            onRemove={removeBlock}
            onReorder={(next: Block[]) => dispatch({ type: 'block.setBlocks', blocks: next })}
            updateBlockProps={updateBlockProps}
            updateBlockScrollTag={updateBlockScrollTag}
            contentAssets={editor.contentAssets}
            pairFieldColumns={pairFieldColumns}
            renderBlockEditor={renderFluxManualBlockEditor}
          />
        )}
        <View className="flex-row flex-wrap gap-1.5">
          {FLUX_ALL_BLOCK_TYPES.map((type) => (
            <Pressable
              key={type}
              className="border border-[#3A3A3A] rounded-md px-2 py-1 bg-[#2A2A2A] min-w-[44px] min-h-[32px] justify-center"
              onPress={() => addBlock(type)}
            >
              <Text className="text-gray-300 text-[11px] font-instrument">
                + {FLUX_MANUAL_BLOCK_TYPE_LABELS[type]}
              </Text>
            </Pressable>
          ))}
        </View>
          </View>
        ) : activeTab === FLUX_CAMPAIGN_MANUAL_TAB.assets ? (
          <View className="gap-1.5">
        {editor.contentAssets.length > 0 && (
        <View className="gap-2">
          {editor.contentAssets.map((asset) =>
            editingAssetId === asset.id ? (
              <View key={asset.id} className="border border-[#2A2A2A] rounded-xl p-3 bg-[#1A1A1A] gap-2">
                <View className="flex-row flex-wrap gap-2">
                  {(['case_study', 'testimonial', 'stat'] as const).map((type) => (
                    <Pressable
                      key={type}
                      className={`px-3 py-1 rounded-lg ${
                        editAssetType === type
                          ? 'bg-indigo-500/20 border border-indigo-500'
                          : 'bg-[#2A2A2A] border border-[#3A3A3A]'
                      }`}
                      onPress={() => setEditAssetType(type)}
                    >
                      <Text className="text-white text-xs font-instrument">{type.replace('_', ' ')}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  className={fluxPanelInputClass}
                  placeholder="Title"
                  placeholderTextColor="#555"
                  value={editAssetTitle}
                  onChangeText={setEditAssetTitle}
                />
                <TextInput
                  className={fluxPanelInputClass}
                  placeholder="Body"
                  placeholderTextColor="#555"
                  value={editAssetBody}
                  onChangeText={setEditAssetBody}
                  multiline
                />
                <TextInput
                  className={fluxPanelInputClass}
                  placeholder="Metric (optional)"
                  placeholderTextColor="#555"
                  value={editAssetMetric}
                  onChangeText={setEditAssetMetric}
                />
                <TextInput
                  className={fluxPanelInputClass}
                  placeholder="Attribution (optional)"
                  placeholderTextColor="#555"
                  value={editAssetAttribution}
                  onChangeText={setEditAssetAttribution}
                />
                <TextInput
                  className={fluxPanelInputClass}
                  placeholder="Image URL (optional)"
                  placeholderTextColor="#555"
                  value={editAssetImageUrl}
                  onChangeText={setEditAssetImageUrl}
                  autoCapitalize="none"
                />
                <View className="flex-row gap-2">
                  <Button size="2xs" onPress={saveEditAsset}>
                    Save
                  </Button>
                  <Button size="2xs" variant="secondary" onPress={cancelEditAsset}>
                    Cancel
                  </Button>
                </View>
              </View>
            ) : (
              <View
                key={asset.id}
                className="border border-[#2A2A2A] rounded-xl p-2.5 bg-[#1A1A1A] flex-row items-center"
              >
                <View className="flex-1">
                  <Text className="text-white text-sm font-instrument-semibold">{asset.title}</Text>
                  <Text className="text-gray-400 text-xs font-instrument">
                    {asset.type}
                    {asset.metric ? ` · ${asset.metric}` : ''}
                    {asset.imageUrl ? ' · image' : ''}
                  </Text>
                </View>
                <Pressable className="mr-3" onPress={() => beginEditAsset(asset)}>
                  <Text className="text-indigo-400 text-sm font-instrument">Edit</Text>
                </Pressable>
                <Pressable onPress={() => removeAsset(asset.id)}>
                  <Text className="text-red-400 text-sm">✕</Text>
                </Pressable>
              </View>
            ),
          )}
        </View>
        )}
        {showAssetForm ? (
        <View className="border border-[#2A2A2A] rounded-xl p-3 bg-[#1A1A1A] gap-2.5">
          <View className="flex-row gap-2">
            {(['case_study', 'testimonial', 'stat'] as const).map((type) => (
              <Pressable
                key={type}
                className={`px-3 py-1 rounded-lg ${
                  assetType === type
                    ? 'bg-indigo-500/20 border border-indigo-500'
                    : 'bg-[#2A2A2A] border border-[#3A3A3A]'
                }`}
                onPress={() => setAssetType(type)}
              >
                <Text className="text-white text-xs font-instrument">{type.replace('_', ' ')}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            className={fluxPanelInputClass}
            placeholder="Title"
            placeholderTextColor="#555"
            value={assetTitle}
            onChangeText={setAssetTitle}
          />
          <TextInput
            className={fluxPanelInputClass}
            placeholder="Body"
            placeholderTextColor="#555"
            value={assetBody}
            onChangeText={setAssetBody}
            multiline
          />
          <TextInput
            className={fluxPanelInputClass}
            placeholder="Metric (optional)"
            placeholderTextColor="#555"
            value={assetMetric}
            onChangeText={setAssetMetric}
          />
          <TextInput
            className={fluxPanelInputClass}
            placeholder="Attribution (optional)"
            placeholderTextColor="#555"
            value={assetAttribution}
            onChangeText={setAssetAttribution}
          />
          <TextInput
            className={fluxPanelInputClass}
            placeholder="Image URL (optional)"
            placeholderTextColor="#555"
            value={assetImageUrl}
            onChangeText={setAssetImageUrl}
            autoCapitalize="none"
          />
          <View className="flex-row gap-2">
            <Button size="2xs" onPress={addAsset}>
              Add asset
            </Button>
            <Button
              size="2xs"
              variant="secondary"
              onPress={() => {
                setShowAssetForm(false);
                setAssetImageUrl('');
              }}
            >
              Cancel
            </Button>
          </View>
        </View>
        ) : (
        <Pressable
          className="border border-dashed border-[#3A3A3A] rounded-xl p-2.5 items-center"
          onPress={() => {
            setEditingAssetId(null);
            setShowAssetForm(true);
          }}
        >
          <Text className="text-gray-400 text-sm font-instrument">+ Add content asset</Text>
        </Pressable>
        )}
          </View>
        ) : activeTab === FLUX_CAMPAIGN_MANUAL_TAB.spec ? (
          <View className="gap-1.5">
        <Text className={fluxPanelLabelClass}>
          Personalization slots ({copySlots.length})
        </Text>
        <TextInput
          className={fluxPanelInputClass}
          value={editor.copySlots}
          onChangeText={(value) => dispatch({ type: 'template.setCopySlotsText', value })}
          placeholder="headline, subheadline, ctaText"
          placeholderTextColor="#555"
        />
        <Text className={fluxPanelLabelClass}>
          Constraints / methodology spec
        </Text>
        <TextInput
          className={fluxPanelInputTallMultilineClass}
          value={editor.constraints}
          onChangeText={(value) => dispatch({ type: 'template.setConstraints', value })}
          placeholder={FLUX_CONSTRAINTS_SKELETON}
          placeholderTextColor="#555"
          multiline
          textAlignVertical="top"
        />
          </View>
        ) : activeTab === FLUX_CAMPAIGN_MANUAL_TAB.prospects ? (
          <View className="gap-1.5">
        <View className="flex-row items-center justify-end">
          <Button size="2xs" onPress={onNavigateNewProspect}>
            + New Prospect
          </Button>
        </View>
        {prospects.length === 0 ? (
          <View className="border border-[#2A2A2A] rounded-xl p-3 items-center">
            <Text className="text-gray-400 text-sm font-instrument">
              No prospects yet for this campaign.
            </Text>
          </View>
        ) : (
          <View className="gap-2">
            {prospects.map((prospect) => (
              <Pressable
                key={prospect.id}
                className="border border-[#2A2A2A] rounded-xl p-3 bg-[#1A1A1A]"
                onPress={() => onNavigateProspect(prospect.id)}
              >
                <Text className="text-white text-sm font-instrument-semibold">{prospect.name}</Text>
                <Text className="text-gray-400 text-xs font-instrument">
                  {prospect.company}
                  {prospect.role ? ` · ${prospect.role}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
          </View>
        ) : null}
    </View>
  );
}
