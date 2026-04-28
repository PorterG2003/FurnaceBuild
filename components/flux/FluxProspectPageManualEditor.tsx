import React, { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { PaintBrushIcon, RectangleStackIcon, TagIcon, UserIcon } from 'react-native-heroicons/outline';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
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
import type { Block, ContentAsset, PageConfig } from '@/lib/flux/types';

const SECTION_PROSPECT_DETAILS = 'Prospect details';
const SECTION_BRAND_DETAILS = 'Brand details';
const SECTION_THEME = 'Theme';
const SECTION_BLOCKS = 'Blocks';

interface FluxProspectPageManualEditorProps {
  pageConfig: PageConfig;
  onChange: (next: PageConfig) => void;
  contentAssets: ContentAsset[];
  campaignId: string;
  /** Contact / firm fields (CRM row). Shown in “Prospect details” when set with `prospectBrandSlot`. */
  prospectLeadSlot?: React.ReactNode;
  /** Brand on the prospect row; optional intel / save actions. Shown in “Brand details”. */
  prospectBrandSlot?: React.ReactNode;
}

export function FluxProspectPageManualEditor({
  pageConfig,
  onChange,
  contentAssets,
  campaignId,
  prospectLeadSlot,
  prospectBrandSlot,
}: FluxProspectPageManualEditorProps) {
  const router = useRouter();
  const [openSections, setOpenSections] = useState<string[]>([
    SECTION_PROSPECT_DETAILS,
    SECTION_BRAND_DETAILS,
    SECTION_THEME,
    SECTION_BLOCKS,
  ]);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setOpenSections((current) =>
      current.includes(section) ? current.filter((value) => value !== section) : [...current, section],
    );
  };

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

  const setBlocks = useCallback(
    (blocks: Block[]) => {
      onChange({ ...pageConfig, blocks });
    },
    [onChange, pageConfig],
  );

  const noopRemove = useCallback(() => {}, []);

  return (
    <View className="gap-3">
      <Pressable
        className="border border-[#2A2A2A] rounded-xl px-3 py-2.5 bg-[#1A1A1A]"
        onPress={() => router.push(`/flux/campaigns/${campaignId}` as Href)}
      >
        <Text className="text-gray-400 text-xs font-instrument">
          Content assets (case studies, testimonials) are edited in the campaign template.
        </Text>
        <Text className="text-indigo-400 text-sm font-instrument-semibold mt-1">Open campaign →</Text>
      </Pressable>

      {prospectLeadSlot ? (
        <CollapsibleSection
          title={SECTION_PROSPECT_DETAILS}
          icon={UserIcon}
          open={openSections.includes(SECTION_PROSPECT_DETAILS)}
          onToggle={() => toggleSection(SECTION_PROSPECT_DETAILS)}
        >
          {prospectLeadSlot}
        </CollapsibleSection>
      ) : null}

      {prospectBrandSlot ? (
        <CollapsibleSection
          title={SECTION_BRAND_DETAILS}
          icon={TagIcon}
          open={openSections.includes(SECTION_BRAND_DETAILS)}
          onToggle={() => toggleSection(SECTION_BRAND_DETAILS)}
        >
          {prospectBrandSlot}
        </CollapsibleSection>
      ) : null}

      {!prospectLeadSlot && !prospectBrandSlot ? (
        <CollapsibleSection
          title={SECTION_PROSPECT_DETAILS}
          icon={UserIcon}
          open={openSections.includes(SECTION_PROSPECT_DETAILS)}
          onToggle={() => toggleSection(SECTION_PROSPECT_DETAILS)}
        >
          <>
            <Text className="text-gray-400 text-xs font-instrument mb-1">Prospect name (on page)</Text>
            <TextInput
              className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
              value={pageConfig.prospectName}
              onChangeText={(value) => onChange({ ...pageConfig, prospectName: value })}
              placeholder="Name"
              placeholderTextColor="#555"
            />
            <Text className="text-gray-400 text-xs font-instrument mb-1">Company name (on page)</Text>
            <TextInput
              className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2"
              value={pageConfig.companyName}
              onChangeText={(value) => onChange({ ...pageConfig, companyName: value })}
              placeholder="Company"
              placeholderTextColor="#555"
            />
          </>
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection
        title={SECTION_THEME}
        icon={PaintBrushIcon}
        open={openSections.includes(SECTION_THEME)}
        onToggle={() => toggleSection(SECTION_THEME)}
      >
        <Text className="text-gray-400 text-xs font-instrument mb-1">Primary color</Text>
        <FluxHexColorField
          value={pageConfig.theme.primaryColor}
          onChange={(primaryColor) => patchTheme({ primaryColor })}
          placeholder="#4f46e5"
          fallbackHex="#4f46e5"
        />
        <Text className="text-gray-400 text-xs font-instrument mb-1">Accent</Text>
        <FluxHexColorField
          value={pageConfig.theme.accentColor}
          onChange={(accentColor) => patchTheme({ accentColor })}
          placeholder="#10b981"
          fallbackHex="#10b981"
        />
        <Text className="text-gray-400 text-xs font-instrument mb-1">Background</Text>
        <FluxHexColorField
          value={pageConfig.theme.backgroundColor}
          onChange={(backgroundColor) => patchTheme({ backgroundColor })}
          placeholder="#f5f5f5"
          fallbackHex="#f5f5f5"
        />
        <Text className="text-gray-400 text-xs font-instrument mb-1">Text color</Text>
        <FluxHexColorField
          value={pageConfig.theme.textColor}
          onChange={(textColor) => patchTheme({ textColor })}
          placeholder="#1a1a1a"
          fallbackHex="#1a1a1a"
        />
        <Text className="text-gray-400 text-xs font-instrument mb-1">Font</Text>
        <FluxFontFamilyPicker
          value={pageConfig.theme.fontFamily}
          onChange={(fontFamily) => patchTheme({ fontFamily })}
        />
        <Text className="text-gray-400 text-xs font-instrument mb-1">Style preset</Text>
        <View className="gap-2 mb-2">
          {FLUX_BLOCK_STYLE_PRESET_OPTIONS.map((option) => {
            const selected = (pageConfig.theme.blockStylePreset ?? 'classic') === option.id;
            return (
              <Pressable
                key={option.id}
                className={`rounded-lg border px-3 py-2 ${
                  selected ? 'border-indigo-500 bg-indigo-500/15' : 'border-[#333] bg-[#222]'
                }`}
                onPress={() => patchTheme({ blockStylePreset: option.id as FluxBlockStylePreset })}
              >
                <Text className="text-white text-sm font-instrument-semibold">{option.label}</Text>
                <Text className="text-gray-400 text-xs font-instrument mt-0.5">{option.description}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text className="text-gray-400 text-xs font-instrument mb-1">Logo URL (optional)</Text>
        <TextInput
          className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2"
          value={pageConfig.theme.logoUrl ?? ''}
          onChangeText={(value) => patchTheme({ logoUrl: value.trim() ? value : undefined })}
          placeholder="https://…"
          placeholderTextColor="#555"
          autoCapitalize="none"
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={SECTION_BLOCKS}
        icon={RectangleStackIcon}
        open={openSections.includes(SECTION_BLOCKS)}
        onToggle={() => toggleSection(SECTION_BLOCKS)}
      >
        {pageConfig.blocks.length === 0 ? (
          <View className="border border-[#2A2A2A] rounded-xl p-3">
            <Text className="text-gray-400 text-sm font-instrument text-center">No blocks on this page.</Text>
          </View>
        ) : (
          <FluxTemplateBlocksDraggableList
            blocks={pageConfig.blocks}
            blockTypeLabels={FLUX_MANUAL_BLOCK_TYPE_LABELS}
            blockSummary={fluxManualBlockSummary}
            editingBlockId={editingBlockId}
            onToggleEditing={(blockId: string) =>
              setEditingBlockId((id) => (id === blockId ? null : blockId))
            }
            onRemove={noopRemove}
            allowRemoveBlocks={false}
            onReorder={(next: Block[]) =>
              setBlocks(next.map((b, i) => ({ ...b, order: i })))
            }
            updateBlockProps={updateBlockProps}
            contentAssets={contentAssets}
            renderBlockEditor={renderFluxManualBlockEditor}
          />
        )}
      </CollapsibleSection>
    </View>
  );
}
