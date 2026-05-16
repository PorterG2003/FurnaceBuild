import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { FluxFontFamilyPicker } from '@/components/flux/FluxFontFamilyPicker';
import { FluxHexColorField } from '@/components/flux/FluxHexColorField';
import { FluxTemplateBlocksDraggableList } from '@/components/flux/FluxTemplateBlocksDraggableList';
import {
  FLUX_MANUAL_BLOCK_TYPE_LABELS,
  fluxManualBlockSummary,
  renderFluxManualBlockEditor,
} from '@/components/flux/FluxManualBlockEditor';
import {
  FLUX_BLOCK_STYLE_PRESET_OPTIONS,
  type FluxBlockStylePreset,
} from '@/lib/flux/fluxPresentationTokens';
import {
  fluxPanelHexContainerRowClass,
  fluxPanelInputClass,
  fluxPanelInputFieldClass,
  fluxPanelLabelClass,
  fluxPanelSectionCardClass,
} from '@/lib/flux/fluxEditorPanelClasses';
import { useFluxEditorPanelTwoColumns } from '@/lib/flux/useFluxEditorPanelTwoColumns';
import type { Block, ContentAsset, PageConfig } from '@/lib/flux/types';

/** Section ids for the prospect page editor (parent owns the tab bar). */
export const FLUX_PROSPECT_PAGE_TAB = {
  lead: 'lead',
  brand: 'brand',
  onpage: 'onpage',
  theme: 'theme',
  blocks: 'blocks',
  campaign: 'campaign',
} as const;

interface FluxProspectPageManualEditorProps {
  pageConfig: PageConfig;
  onChange: (next: PageConfig) => void;
  contentAssets: ContentAsset[];
  campaignId: string;
  /** Which section to show (must match a tab id on the parent). */
  activeSection: string;
  /** Contact / firm fields (CRM row). Shown in “Prospect details” when set with `prospectBrandSlot`. */
  prospectLeadSlot?: React.ReactNode;
  /** Brand on the prospect row; optional intel / save actions. Shown in “Brand details”. */
  prospectBrandSlot?: React.ReactNode;
  /** When set, opens the matching block editor so validation issues are easier to fix. */
  requestedEditingBlockId?: string | null;
  /** Per-block issue counts shown in the block summaries. */
  issueCountByBlockId?: Record<string, number>;
  /** Parent switches to the Blocks tab when a block should be focused (e.g. validation). */
  onRequestSection?: (section: string) => void;
}

export function FluxProspectPageManualEditor({
  pageConfig,
  onChange,
  contentAssets,
  campaignId,
  activeSection,
  prospectLeadSlot,
  prospectBrandSlot,
  requestedEditingBlockId = null,
  issueCountByBlockId = {},
  onRequestSection,
}: FluxProspectPageManualEditorProps) {
  const router = useRouter();
  const pairFieldColumns = useFluxEditorPanelTwoColumns();
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  useEffect(() => {
    if (!requestedEditingBlockId) return;
    setEditingBlockId(requestedEditingBlockId);
    onRequestSection?.(FLUX_PROSPECT_PAGE_TAB.blocks);
  }, [requestedEditingBlockId, onRequestSection]);

  const patchTheme = useCallback(
    (patch: Partial<PageConfig['theme']>) => {
      onChange({
        ...pageConfig,
        theme: { ...pageConfig.theme, ...patch },
      });
    },
    [onChange, pageConfig],
  );

  const updateBlockProps = useCallback(
    (blockId: string, props: Record<string, unknown>) => {
      onChange({
        ...pageConfig,
        blocks: pageConfig.blocks.map((b) =>
          b.id === blockId ? ({ ...b, props: { ...b.props, ...props } } as Block) : b,
        ),
      });
    },
    [onChange, pageConfig],
  );

  const updateBlockScrollTag = useCallback(
    (blockId: string, scrollTag: string | undefined) => {
      onChange({
        ...pageConfig,
        blocks: pageConfig.blocks.map((b) => {
          if (b.id !== blockId) return b;
          const next = { ...b } as Block;
          if (!scrollTag?.trim()) {
            delete (next as { scrollTag?: string }).scrollTag;
          } else {
            (next as { scrollTag?: string }).scrollTag = scrollTag.trim();
          }
          return next;
        }),
      });
    },
    [onChange, pageConfig],
  );

  const setBlocks = useCallback(
    (blocks: Block[]) => {
      onChange({ ...pageConfig, blocks });
    },
    [onChange, pageConfig],
  );

  const noopRemove = useCallback(() => {}, []);

  const blockSummaryWithIssues = useCallback(
    (block: Block) => {
      const summary = fluxManualBlockSummary(block);
      const issueCount = issueCountByBlockId[block.id] ?? 0;
      if (issueCount < 1) return summary;
      return `${summary} · ${issueCount} issue${issueCount === 1 ? '' : 's'}`;
    },
    [issueCountByBlockId],
  );

  return (
    <View className="flex-1 min-w-0 self-stretch">
        {activeSection === FLUX_PROSPECT_PAGE_TAB.campaign ? (
          <Pressable
            className={`${fluxPanelSectionCardClass} px-2.5 py-2`}
            onPress={() => router.push(`/flux/campaigns/${campaignId}` as Href)}
          >
            <Text className="text-gray-400 text-[11px] font-instrument leading-4">
              Content assets (case studies, testimonials) are edited in the campaign template.
            </Text>
            <Text className="text-indigo-400 text-xs font-instrument-semibold mt-0.5">Open campaign →</Text>
          </Pressable>
        ) : null}

        {activeSection === FLUX_PROSPECT_PAGE_TAB.lead && prospectLeadSlot ? (
            <View className="gap-1.5">{prospectLeadSlot}</View>
          ) : null}

        {activeSection === FLUX_PROSPECT_PAGE_TAB.brand && prospectBrandSlot ? (
            <View className="gap-1.5">{prospectBrandSlot}</View>
          ) : null}

        {activeSection === FLUX_PROSPECT_PAGE_TAB.onpage && !prospectLeadSlot && !prospectBrandSlot ? (
            <View className="gap-1.5">
              {pairFieldColumns ? (
                <View className="flex-row gap-2 flex-wrap">
                  <View className="flex-1 min-w-[120px]">
                    <Text className={fluxPanelLabelClass}>Prospect name (on page)</Text>
                    <TextInput
                      className={`${fluxPanelInputFieldClass} w-full`}
                      value={pageConfig.prospectName}
                      onChangeText={(value) => onChange({ ...pageConfig, prospectName: value })}
                      placeholder="Name"
                      placeholderTextColor="#555"
                    />
                  </View>
                  <View className="flex-1 min-w-[120px]">
                    <Text className={fluxPanelLabelClass}>Company name (on page)</Text>
                    <TextInput
                      className={`${fluxPanelInputFieldClass} w-full`}
                      value={pageConfig.companyName}
                      onChangeText={(value) => onChange({ ...pageConfig, companyName: value })}
                      placeholder="Company"
                      placeholderTextColor="#555"
                    />
                  </View>
                </View>
              ) : (
                <>
                  <Text className={fluxPanelLabelClass}>Prospect name (on page)</Text>
                  <TextInput
                    className={fluxPanelInputClass}
                    value={pageConfig.prospectName}
                    onChangeText={(value) => onChange({ ...pageConfig, prospectName: value })}
                    placeholder="Name"
                    placeholderTextColor="#555"
                  />
                  <Text className={fluxPanelLabelClass}>Company name (on page)</Text>
                  <TextInput
                    className={`${fluxPanelInputFieldClass} w-full`}
                    value={pageConfig.companyName}
                    onChangeText={(value) => onChange({ ...pageConfig, companyName: value })}
                    placeholder="Company"
                    placeholderTextColor="#555"
                  />
                </>
              )}
            </View>
          ) : null}

        {activeSection === FLUX_PROSPECT_PAGE_TAB.theme ? (
            <View className="gap-1.5">
              {pairFieldColumns ? (
                <>
                  <View className="flex-row gap-2 flex-wrap mb-1.5">
                    <View className="flex-1 min-w-[140px]">
                      <Text className={fluxPanelLabelClass}>Primary color</Text>
                      <FluxHexColorField
                        value={pageConfig.theme.primaryColor}
                        onChange={(primaryColor) => patchTheme({ primaryColor })}
                        placeholder="#4f46e5"
                        fallbackHex="#4f46e5"
                        containerClassName={fluxPanelHexContainerRowClass}
                      />
                    </View>
                    <View className="flex-1 min-w-[140px]">
                      <Text className={fluxPanelLabelClass}>Accent</Text>
                      <FluxHexColorField
                        value={pageConfig.theme.accentColor}
                        onChange={(accentColor) => patchTheme({ accentColor })}
                        placeholder="#10b981"
                        fallbackHex="#10b981"
                        containerClassName={fluxPanelHexContainerRowClass}
                      />
                    </View>
                  </View>
                  <View className="flex-row gap-2 flex-wrap mb-1.5">
                    <View className="flex-1 min-w-[140px]">
                      <Text className={fluxPanelLabelClass}>Background</Text>
                      <FluxHexColorField
                        value={pageConfig.theme.backgroundColor}
                        onChange={(backgroundColor) => patchTheme({ backgroundColor })}
                        placeholder="#f5f5f5"
                        fallbackHex="#f5f5f5"
                        containerClassName={fluxPanelHexContainerRowClass}
                      />
                    </View>
                    <View className="flex-1 min-w-[140px]">
                      <Text className={fluxPanelLabelClass}>Text color</Text>
                      <FluxHexColorField
                        value={pageConfig.theme.textColor}
                        onChange={(textColor) => patchTheme({ textColor })}
                        placeholder="#1a1a1a"
                        fallbackHex="#1a1a1a"
                        containerClassName={fluxPanelHexContainerRowClass}
                      />
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <Text className={fluxPanelLabelClass}>Primary color</Text>
                  <FluxHexColorField
                    value={pageConfig.theme.primaryColor}
                    onChange={(primaryColor) => patchTheme({ primaryColor })}
                    placeholder="#4f46e5"
                    fallbackHex="#4f46e5"
                  />
                  <Text className={fluxPanelLabelClass}>Accent</Text>
                  <FluxHexColorField
                    value={pageConfig.theme.accentColor}
                    onChange={(accentColor) => patchTheme({ accentColor })}
                    placeholder="#10b981"
                    fallbackHex="#10b981"
                  />
                  <Text className={fluxPanelLabelClass}>Background</Text>
                  <FluxHexColorField
                    value={pageConfig.theme.backgroundColor}
                    onChange={(backgroundColor) => patchTheme({ backgroundColor })}
                    placeholder="#f5f5f5"
                    fallbackHex="#f5f5f5"
                  />
                  <Text className={fluxPanelLabelClass}>Text color</Text>
                  <FluxHexColorField
                    value={pageConfig.theme.textColor}
                    onChange={(textColor) => patchTheme({ textColor })}
                    placeholder="#1a1a1a"
                    fallbackHex="#1a1a1a"
                  />
                </>
              )}
              <Text className={fluxPanelLabelClass}>Font</Text>
              <FluxFontFamilyPicker
                value={pageConfig.theme.fontFamily}
                onChange={(fontFamily) => patchTheme({ fontFamily })}
              />
              <Text className={fluxPanelLabelClass}>Style preset</Text>
              <View className="gap-1.5 mb-1.5">
                {FLUX_BLOCK_STYLE_PRESET_OPTIONS.map((option) => {
                  const selected = (pageConfig.theme.blockStylePreset ?? 'classic') === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      className={`rounded-md border px-2 py-1.5 ${
                        selected ? 'border-indigo-500 bg-indigo-500/15' : 'border-[#333] bg-[#222]'
                      }`}
                      onPress={() => patchTheme({ blockStylePreset: option.id as FluxBlockStylePreset })}
                    >
                      <Text className="text-white text-xs font-instrument-semibold">{option.label}</Text>
                      <Text className="text-gray-400 text-[11px] font-instrument mt-0.5 leading-4">
                        {option.description}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text className={fluxPanelLabelClass}>Copy length limits</Text>
              <View className="border border-[#333] rounded-md p-2 bg-[#222] gap-1.5 mb-1.5">
                <Text className="text-gray-300 text-[11px] font-instrument leading-4">
                  The selected layout preset enforces hard copy limits when you save. Enable this only when you need a
                  manual exception and are okay with possible overflow in tighter layouts.
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  <Pressable
                    className={`rounded-md border px-2 py-1.5 ${
                      !pageConfig.theme.allowLongCopy
                        ? 'border-indigo-500 bg-indigo-500/15'
                        : 'border-[#333] bg-[#1A1A1A]'
                    }`}
                    onPress={() => patchTheme({ allowLongCopy: undefined })}
                  >
                    <Text className="text-white text-[11px] font-instrument-semibold">Enforce limits</Text>
                  </Pressable>
                  <Pressable
                    className={`rounded-md border px-2 py-1.5 ${
                      pageConfig.theme.allowLongCopy
                        ? 'border-amber-500 bg-amber-500/15'
                        : 'border-[#333] bg-[#1A1A1A]'
                    }`}
                    onPress={() => patchTheme({ allowLongCopy: true })}
                  >
                    <Text className="text-white text-[11px] font-instrument-semibold">Allow long copy</Text>
                  </Pressable>
                </View>
              </View>
              <Text className={fluxPanelLabelClass}>Logo URL (optional)</Text>
              <TextInput
                className={fluxPanelInputFieldClass}
                value={pageConfig.theme.logoUrl ?? ''}
                onChangeText={(value) => patchTheme({ logoUrl: value.trim() ? value : undefined })}
                placeholder="https://…"
                placeholderTextColor="#555"
                autoCapitalize="none"
              />
            </View>
          ) : null}

        {activeSection === FLUX_PROSPECT_PAGE_TAB.blocks ? (
            <View className="gap-1.5">
              {pageConfig.blocks.length === 0 ? (
                <View className="border border-[#2A2A2A] rounded-lg p-2">
                  <Text className="text-gray-400 text-xs font-instrument text-center">No blocks on this page.</Text>
                </View>
              ) : (
                <FluxTemplateBlocksDraggableList
                  blocks={pageConfig.blocks}
                  blockTypeLabels={FLUX_MANUAL_BLOCK_TYPE_LABELS}
                  blockSummary={blockSummaryWithIssues}
                  editingBlockId={editingBlockId}
                  onToggleEditing={(blockId: string) =>
                    setEditingBlockId((id) => (id === blockId ? null : blockId))
                  }
                  onRemove={noopRemove}
                  allowRemoveBlocks={false}
                  pairFieldColumns={pairFieldColumns}
                  onReorder={(next: Block[]) => setBlocks(next.map((b, i) => ({ ...b, order: i })))}
                  updateBlockProps={updateBlockProps}
                  updateBlockScrollTag={updateBlockScrollTag}
                  contentAssets={contentAssets}
                  renderBlockEditor={renderFluxManualBlockEditor}
                />
              )}
            </View>
        ) : null}
    </View>
  );
}
