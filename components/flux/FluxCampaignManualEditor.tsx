import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import {
  BriefcaseIcon,
  FolderIcon,
  MegaphoneIcon,
  PencilSquareIcon,
  RectangleStackIcon,
  UserGroupIcon,
  UserIcon,
} from 'react-native-heroicons/outline';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
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
  FLUX_CONSTRAINTS_SKELETON,
  parseFluxCopySlots,
} from '@/lib/flux/fluxCampaignMethodologyQa';
import type { Block, ContentAsset, FluxPreviewProspectInput, FluxProspectRow } from '@/lib/flux/types';
import type {
  FluxCampaignEditorAction,
  FluxCampaignEditorState,
} from '@/lib/flux/editor/reducer';

const MANUAL_SECTION_CAMPAIGN = 'Campaign';
const MANUAL_SECTION_SELLER = 'Seller (your company)';
const MANUAL_SECTION_PAGE_BRANDING = 'Merged preview branding';
const MANUAL_SECTION_TEMPLATE_BLOCKS = 'Template blocks';
const MANUAL_SECTION_CONTENT_ASSETS = 'Content assets';
const MANUAL_SECTION_CAMPAIGN_SPEC = 'Campaign spec';
const MANUAL_SECTION_PROSPECTS = 'Prospects';

interface FluxCampaignManualEditorProps {
  editor: FluxCampaignEditorState;
  dispatch: React.Dispatch<FluxCampaignEditorAction>;
  prospects: FluxProspectRow[];
  onNavigateNewProspect: () => void;
  onNavigateProspect: (prospectId: string) => void;
}

export function FluxCampaignManualEditor({
  editor,
  dispatch,
  prospects,
  onNavigateNewProspect,
  onNavigateProspect,
}: FluxCampaignManualEditorProps) {
  const [openSections, setOpenSections] = useState<string[]>([]);
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

  const toggleSection = (section: string) => {
    setOpenSections((current) =>
      current.includes(section) ? current.filter((value) => value !== section) : [...current, section],
    );
  };

  return (
    <View className="gap-3">
      <CollapsibleSection
        title={MANUAL_SECTION_CAMPAIGN}
        icon={MegaphoneIcon}
        open={openSections.includes(MANUAL_SECTION_CAMPAIGN)}
        onToggle={() => toggleSection(MANUAL_SECTION_CAMPAIGN)}
      >
        <TextInput
          className="text-white text-xl font-instrument-semibold bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-2.5"
          value={editor.name}
          onChangeText={(value) => dispatch({ type: 'campaign.setName', value })}
          placeholder="Campaign name"
          placeholderTextColor="#555"
        />
        <TextInput
          className="text-gray-300 text-sm font-instrument bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-2.5"
          value={editor.offerDescription}
          onChangeText={(value) => dispatch({ type: 'campaign.setOfferDescription', value })}
          placeholder="Who this campaign is for and what the reader should get from it"
          placeholderTextColor="#555"
          multiline
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={MANUAL_SECTION_SELLER}
        icon={BriefcaseIcon}
        open={openSections.includes(MANUAL_SECTION_SELLER)}
        onToggle={() => toggleSection(MANUAL_SECTION_SELLER)}
      >
        <Text className="text-gray-400 text-xs font-instrument mb-2">
          Who runs this campaign (your agency or client). Separate from the sample recipient below.
        </Text>
        <Text className="text-gray-400 text-xs font-instrument mb-1">Display name</Text>
        <TextInput
          className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
          value={editor.sellerProfile.displayName}
          onChangeText={(value) => dispatch({ type: 'seller.patchProfile', patch: { displayName: value } })}
          placeholder="Your company name"
          placeholderTextColor="#555"
        />
        <Text className="text-gray-400 text-xs font-instrument mb-1">Tagline</Text>
        <TextInput
          className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
          value={editor.sellerProfile.tagline}
          onChangeText={(value) => dispatch({ type: 'seller.patchProfile', patch: { tagline: value } })}
          placeholder="One-line positioning"
          placeholderTextColor="#555"
        />
        <Text className="text-gray-400 text-xs font-instrument mb-1">Website URL</Text>
        <TextInput
          className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
          value={editor.sellerProfile.websiteUrl}
          onChangeText={(value) => dispatch({ type: 'seller.patchProfile', patch: { websiteUrl: value } })}
          placeholder="https://…"
          placeholderTextColor="#555"
          autoCapitalize="none"
        />
        <View className="flex-row items-center gap-2 mb-3">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void handleSellerWebsiteScrape()}
            disabled={sellerScrapeBusy}
          >
            {sellerScrapeBusy ? 'Scraping…' : 'Refresh from website'}
          </Button>
          {sellerScrapeBusy ? <ActivityIndicator color="#9ca3af" /> : null}
        </View>
        <FluxHexColorField
          label="Primary"
          value={editor.sellerProfile.brand_profile?.primaryColor ?? '#4f46e5'}
          onChange={(primaryColor) =>
            dispatch({ type: 'seller.patchBrand', patch: { primaryColor } })
          }
        />
        <FluxHexColorField
          label="Accent"
          value={editor.sellerProfile.brand_profile?.accentColor ?? ''}
          onChange={(hex) => dispatch({ type: 'seller.patchBrand', patch: { accentColor: hex || undefined } })}
        />
        <FluxFontFamilyPicker
          label="Font"
          value={editor.sellerProfile.brand_profile?.fontFamily}
          onChange={(fontFamily) => dispatch({ type: 'seller.patchBrand', patch: { fontFamily } })}
        />
        <Text className="text-gray-400 text-xs font-instrument mb-1 mt-2">Logo URL</Text>
        <TextInput
          className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
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
      </CollapsibleSection>

      <CollapsibleSection
        title={MANUAL_SECTION_PAGE_BRANDING}
        icon={RectangleStackIcon}
        open={openSections.includes(MANUAL_SECTION_PAGE_BRANDING)}
        onToggle={() => toggleSection(MANUAL_SECTION_PAGE_BRANDING)}
      >
        <Text className="text-gray-400 text-xs font-instrument mb-2">
          How seller and sample recipient brands combine for the live preview theme.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {(['prospect', 'seller', 'merge'] as const).map((mode) => {
            const selected = editor.brandingPolicy.pageTheme === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => setPageTheme(mode)}
                className={`px-3 py-2 rounded-lg border ${
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
      </CollapsibleSection>

      <CollapsibleSection
        title="Sample recipient (preview only)"
        icon={UserIcon}
        open={editor.previewProspectOpen}
        onToggle={() =>
          dispatch({ type: 'ui.setPreviewProspectOpen', value: !editor.previewProspectOpen })
        }
      >
        <View className="border border-[#2A2A2A] rounded-xl p-3 bg-[#1A1A1A] gap-1">
          <Text className="text-gray-400 text-xs font-instrument mb-2">
            Use a realistic lead here. Theme changes show instantly; copy and structure changes may
            need a fresh AI preview in the studio.
          </Text>
          <Text className="text-gray-400 text-xs font-instrument mb-1">Contact name</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.name}
            onChangeText={(value) => patchPreviewProspect({ name: value })}
            placeholder="Jane Smith"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Company</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.company}
            onChangeText={(value) => patchPreviewProspect({ company: value })}
            placeholder="Acme Corp"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Role</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.role ?? ''}
            onChangeText={(value) => patchPreviewProspect({ role: value })}
            placeholder="VP of Sales"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Company URL</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.url ?? ''}
            onChangeText={(value) => patchPreviewProspect({ url: value })}
            placeholder="https://acme.com"
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Industry</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.industry ?? ''}
            onChangeText={(value) => patchPreviewProspect({ industry: value })}
            placeholder="SaaS"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Company size</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.company_size ?? ''}
            onChangeText={(value) => patchPreviewProspect({ company_size: value })}
            placeholder="50-200"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Email notes</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-3 min-h-[72px]"
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
          <Text className="text-gray-500 text-xs uppercase tracking-wider mb-2 font-instrument-semibold">
            Brand
          </Text>
          <Text className="text-gray-400 text-xs font-instrument mb-1">Primary color</Text>
          <FluxHexColorField
            value={editor.previewProspect.brand_profile?.primaryColor ?? '#4f46e5'}
            onChange={(primaryColor) => patchPreviewBrand({ primaryColor })}
            placeholder="#4f46e5"
            fallbackHex="#4f46e5"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Accent (optional)</Text>
          <FluxHexColorField
            value={editor.previewProspect.brand_profile?.accentColor ?? ''}
            onChange={(hex) => patchPreviewBrand({ accentColor: hex || undefined })}
            allowEmpty
            placeholder="#10b981"
            fallbackHex="#10b981"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Font</Text>
          <FluxFontFamilyPicker
            value={editor.previewProspect.brand_profile?.fontFamily}
            onChange={(fontFamily) => patchPreviewBrand({ fontFamily })}
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Style preset</Text>
          <View className="gap-2 mb-2">
            {FLUX_BLOCK_STYLE_PRESET_OPTIONS.map((option) => {
              const selected = (editor.previewProspect.brand_profile?.blockStylePreset ?? 'classic') === option.id;
              return (
                <Pressable
                  key={option.id}
                  className={`rounded-lg border px-3 py-2 ${
                    selected ? 'border-indigo-500 bg-indigo-500/15' : 'border-[#333] bg-[#222]'
                  }`}
                  onPress={() => patchPreviewBrand({ blockStylePreset: option.id })}
                >
                  <Text className="text-white text-sm font-instrument-semibold">{option.label}</Text>
                  <Text className="text-gray-400 text-xs font-instrument mt-0.5">{option.description}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-gray-400 text-xs font-instrument mb-1">Logo URL (optional)</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.brand_profile?.logoUrl ?? ''}
            onChangeText={(value) => patchPreviewBrand({ logoUrl: value || undefined })}
            placeholder="https://…"
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
          {prospects.length > 0 ? (
            <Button
              size="sm"
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
      </CollapsibleSection>

      <CollapsibleSection
        title={MANUAL_SECTION_TEMPLATE_BLOCKS}
        icon={RectangleStackIcon}
        open={openSections.includes(MANUAL_SECTION_TEMPLATE_BLOCKS)}
        onToggle={() => toggleSection(MANUAL_SECTION_TEMPLATE_BLOCKS)}
      >
        {editor.blocks.length === 0 ? (
          <View className="border border-[#2A2A2A] rounded-xl p-3">
            <Text className="text-gray-400 text-sm font-instrument text-center">
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
            renderBlockEditor={renderFluxManualBlockEditor}
          />
        )}
        <View className="flex-row flex-wrap gap-2">
          {FLUX_ALL_BLOCK_TYPES.map((type) => (
            <Pressable
              key={type}
              className="border border-[#3A3A3A] rounded-lg px-3 py-1.5 bg-[#2A2A2A]"
              onPress={() => addBlock(type)}
            >
              <Text className="text-gray-300 text-xs font-instrument">
                + {FLUX_MANUAL_BLOCK_TYPE_LABELS[type]}
              </Text>
            </Pressable>
          ))}
        </View>
      </CollapsibleSection>

      <CollapsibleSection
        title={MANUAL_SECTION_CONTENT_ASSETS}
        icon={FolderIcon}
        open={openSections.includes(MANUAL_SECTION_CONTENT_ASSETS)}
        onToggle={() => toggleSection(MANUAL_SECTION_CONTENT_ASSETS)}
      >
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
                  className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
                  placeholder="Title"
                  placeholderTextColor="#555"
                  value={editAssetTitle}
                  onChangeText={setEditAssetTitle}
                />
                <TextInput
                  className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
                  placeholder="Body"
                  placeholderTextColor="#555"
                  value={editAssetBody}
                  onChangeText={setEditAssetBody}
                  multiline
                />
                <TextInput
                  className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
                  placeholder="Metric (optional)"
                  placeholderTextColor="#555"
                  value={editAssetMetric}
                  onChangeText={setEditAssetMetric}
                />
                <TextInput
                  className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
                  placeholder="Attribution (optional)"
                  placeholderTextColor="#555"
                  value={editAssetAttribution}
                  onChangeText={setEditAssetAttribution}
                />
                <TextInput
                  className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
                  placeholder="Image URL (optional)"
                  placeholderTextColor="#555"
                  value={editAssetImageUrl}
                  onChangeText={setEditAssetImageUrl}
                  autoCapitalize="none"
                />
                <View className="flex-row gap-2">
                  <Button size="sm" onPress={saveEditAsset}>
                    Save
                  </Button>
                  <Button size="sm" variant="secondary" onPress={cancelEditAsset}>
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
            className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
            placeholder="Title"
            placeholderTextColor="#555"
            value={assetTitle}
            onChangeText={setAssetTitle}
          />
          <TextInput
            className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
            placeholder="Body"
            placeholderTextColor="#555"
            value={assetBody}
            onChangeText={setAssetBody}
            multiline
          />
          <TextInput
            className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
            placeholder="Metric (optional)"
            placeholderTextColor="#555"
            value={assetMetric}
            onChangeText={setAssetMetric}
          />
          <TextInput
            className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
            placeholder="Attribution (optional)"
            placeholderTextColor="#555"
            value={assetAttribution}
            onChangeText={setAssetAttribution}
          />
          <TextInput
            className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm"
            placeholder="Image URL (optional)"
            placeholderTextColor="#555"
            value={assetImageUrl}
            onChangeText={setAssetImageUrl}
            autoCapitalize="none"
          />
          <View className="flex-row gap-2">
            <Button size="sm" onPress={addAsset}>
              Add asset
            </Button>
            <Button
              size="sm"
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
      </CollapsibleSection>

      <CollapsibleSection
        title={MANUAL_SECTION_CAMPAIGN_SPEC}
        icon={PencilSquareIcon}
        open={openSections.includes(MANUAL_SECTION_CAMPAIGN_SPEC)}
        onToggle={() => toggleSection(MANUAL_SECTION_CAMPAIGN_SPEC)}
      >
        <Text className="text-gray-400 text-xs font-instrument mb-1">
          Personalization slots ({copySlots.length})
        </Text>
        <TextInput
          className="text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-2.5 text-sm"
          value={editor.copySlots}
          onChangeText={(value) => dispatch({ type: 'template.setCopySlotsText', value })}
          placeholder="headline, subheadline, ctaText"
          placeholderTextColor="#555"
        />
        <Text className="text-gray-400 text-xs font-instrument mb-1">
          Constraints / methodology spec
        </Text>
        <TextInput
          className="text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-2.5 text-sm min-h-[220px]"
          value={editor.constraints}
          onChangeText={(value) => dispatch({ type: 'template.setConstraints', value })}
          placeholder={FLUX_CONSTRAINTS_SKELETON}
          placeholderTextColor="#555"
          multiline
          textAlignVertical="top"
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={MANUAL_SECTION_PROSPECTS}
        icon={UserGroupIcon}
        open={openSections.includes(MANUAL_SECTION_PROSPECTS)}
        onToggle={() => toggleSection(MANUAL_SECTION_PROSPECTS)}
      >
        <View className="flex-row items-center justify-end">
          <Button size="xs" onPress={onNavigateNewProspect}>
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
      </CollapsibleSection>
    </View>
  );
}
