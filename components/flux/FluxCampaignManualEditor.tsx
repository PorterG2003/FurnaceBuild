import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { FluxFontFamilyPicker } from '@/components/flux/FluxFontFamilyPicker';
import { FluxTemplateBlocksDraggableList } from '@/components/flux/FluxTemplateBlocksDraggableList';
import { defaultFluxPreviewProspect } from '@/lib/flux/fluxCampaignPreview';
import {
  FLUX_CONSTRAINTS_SKELETON,
  parseFluxCopySlots,
} from '@/lib/flux/fluxCampaignMethodologyQa';
import type {
  Block,
  BlockType,
  ContentAsset,
  FluxPreviewProspectInput,
  FluxProspectRow,
} from '@/lib/flux/types';
import type {
  FluxCampaignEditorAction,
  FluxCampaignEditorState,
} from '@/lib/flux/editor/reducer';

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  hero: 'Hero',
  social_proof: 'Social Proof',
  case_study: 'Case Study',
  benefits: 'Benefits',
  testimonial: 'Testimonial',
  cta: 'CTA',
  tanners_tax_strategy: 'Tax strategy calculator',
  social_media_plan: 'Social media plan',
};

const ALL_BLOCK_TYPES: BlockType[] = [
  'hero',
  'social_proof',
  'case_study',
  'benefits',
  'testimonial',
  'cta',
  'tanners_tax_strategy',
  'social_media_plan',
];

const MANUAL_SECTION_CAMPAIGN = 'Campaign';
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

function blockSummary(block: Block): string {
  switch (block.type) {
    case 'hero':
      return block.props.headline || '(empty headline)';
    case 'social_proof':
      return `${block.props.logos.length} logos`;
    case 'case_study':
      return block.props.overrideTitle || `asset: ${block.props.assetId || '(none)'}`;
    case 'benefits':
      return `${block.props.items.length} items`;
    case 'testimonial':
      return block.props.overrideQuote?.slice(0, 40) || `asset: ${block.props.assetId || '(none)'}`;
    case 'cta':
      return block.props.headline || '(empty)';
    case 'tanners_tax_strategy':
      return block.props.heading || '(calculator)';
    case 'social_media_plan':
      return block.props.inferred_vertical || '(social plan)';
  }
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
  const [assetType, setAssetType] = useState<'case_study' | 'testimonial' | 'stat'>('case_study');

  const copySlots = useMemo(() => parseFluxCopySlots(editor.copySlots), [editor.copySlots]);

  const patchPreviewProspect = (patch: Partial<FluxPreviewProspectInput>) => {
    dispatch({ type: 'preview.patchProspect', patch });
  };

  const patchPreviewBrand = (patch: {
    primaryColor?: string;
    accentColor?: string;
    fontFamily?: string;
    logoUrl?: string;
  }) => {
    dispatch({ type: 'preview.patchBrand', patch });
  };

  const addBlock = (type: BlockType) => {
    dispatch({ type: 'block.add', blockType: type });
  };

  const removeBlock = (blockId: string) => {
    dispatch({ type: 'block.remove', blockId });
  };

  const updateBlockProps = (blockId: string, props: Record<string, unknown>) => {
    dispatch({ type: 'block.updateProps', blockId, props });
  };

  const addAsset = () => {
    const asset: ContentAsset = {
      id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: assetType,
      title: assetTitle,
      body: assetBody,
      metric: assetMetric || undefined,
      attribution: assetAttribution || undefined,
    };
    dispatch({ type: 'asset.add', asset });
    setShowAssetForm(false);
    setAssetTitle('');
    setAssetBody('');
    setAssetMetric('');
    setAssetAttribution('');
  };

  const removeAsset = (assetId: string) => {
    dispatch({ type: 'asset.remove', assetId });
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
        title="Sample lead for proofing"
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
          <Text className="text-gray-500 text-xs uppercase tracking-wider mb-2 font-instrument-semibold">
            Brand
          </Text>
          <Text className="text-gray-400 text-xs font-instrument mb-1">Primary color</Text>
          <View className="flex-row items-center gap-2 mb-2">
            <View
              className="w-7 h-7 rounded-md border border-[#444]"
              style={{ backgroundColor: editor.previewProspect.brand_profile?.primaryColor ?? '#4f46e5' }}
            />
            <TextInput
              className="flex-1 text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2"
              value={editor.previewProspect.brand_profile?.primaryColor ?? '#4f46e5'}
              onChangeText={(value) => patchPreviewBrand({ primaryColor: value })}
              placeholder="#4f46e5"
              placeholderTextColor="#555"
              autoCapitalize="none"
            />
          </View>
          <Text className="text-gray-400 text-xs font-instrument mb-1">Accent (optional)</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.brand_profile?.accentColor ?? ''}
            onChangeText={(value) => patchPreviewBrand({ accentColor: value || undefined })}
            placeholder="#10b981"
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Font</Text>
          <FluxFontFamilyPicker
            value={editor.previewProspect.brand_profile?.fontFamily}
            onChange={(fontFamily) => patchPreviewBrand({ fontFamily })}
          />
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
            blockTypeLabels={BLOCK_TYPE_LABELS}
            blockSummary={blockSummary}
            editingBlockId={editor.editingBlockId}
            onToggleEditing={(blockId: string) => dispatch({ type: 'ui.toggleEditingBlock', blockId })}
            onRemove={removeBlock}
            onReorder={(next: Block[]) => dispatch({ type: 'block.setBlocks', blocks: next })}
            updateBlockProps={updateBlockProps}
            contentAssets={editor.contentAssets}
            renderBlockEditor={renderBlockEditor}
          />
        )}
        <View className="flex-row flex-wrap gap-2">
          {ALL_BLOCK_TYPES.map((type) => (
            <Pressable
              key={type}
              className="border border-[#3A3A3A] rounded-lg px-3 py-1.5 bg-[#2A2A2A]"
              onPress={() => addBlock(type)}
            >
              <Text className="text-gray-300 text-xs font-instrument">+ {BLOCK_TYPE_LABELS[type]}</Text>
            </Pressable>
          ))}
        </View>
      </CollapsibleSection>

      <CollapsibleSection
        title={MANUAL_SECTION_CONTENT_ASSETS}
        open={openSections.includes(MANUAL_SECTION_CONTENT_ASSETS)}
        onToggle={() => toggleSection(MANUAL_SECTION_CONTENT_ASSETS)}
      >
        {editor.contentAssets.length > 0 && (
        <View className="gap-2">
          {editor.contentAssets.map((asset) => (
            <View
              key={asset.id}
              className="border border-[#2A2A2A] rounded-xl p-2.5 bg-[#1A1A1A] flex-row items-center"
            >
              <View className="flex-1">
                <Text className="text-white text-sm font-instrument-semibold">{asset.title}</Text>
                <Text className="text-gray-400 text-xs font-instrument">
                  {asset.type}
                  {asset.metric ? ` · ${asset.metric}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => removeAsset(asset.id)}>
                <Text className="text-red-400 text-sm">✕</Text>
              </Pressable>
            </View>
          ))}
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
          <View className="flex-row gap-2">
            <Button size="sm" onPress={addAsset}>
              Add asset
            </Button>
            <Button size="sm" variant="secondary" onPress={() => setShowAssetForm(false)}>
              Cancel
            </Button>
          </View>
        </View>
        ) : (
        <Pressable
          className="border border-dashed border-[#3A3A3A] rounded-xl p-2.5 items-center"
          onPress={() => setShowAssetForm(true)}
        >
          <Text className="text-gray-400 text-sm font-instrument">+ Add content asset</Text>
        </Pressable>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={MANUAL_SECTION_CAMPAIGN_SPEC}
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

function renderBlockEditor(
  block: Block,
  updateProps: (id: string, props: Record<string, unknown>) => void,
  assets: ContentAsset[],
) {
  const inputClass = 'text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm mb-2';

  switch (block.type) {
    case 'hero':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Headline</Text>
          <TextInput
            className={inputClass}
            value={block.props.headline}
            onChangeText={(value) => updateProps(block.id, { headline: value })}
            placeholder="Headline"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">Subheadline</Text>
          <TextInput
            className={inputClass}
            value={block.props.subheadline}
            onChangeText={(value) => updateProps(block.id, { subheadline: value })}
            placeholder="Subheadline"
            placeholderTextColor="#555"
            multiline
          />
          <Text className="text-gray-400 text-xs">CTA Text</Text>
          <TextInput
            className={inputClass}
            value={block.props.ctaText}
            onChangeText={(value) => updateProps(block.id, { ctaText: value })}
            placeholder="CTA text"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">CTA URL</Text>
          <TextInput
            className={inputClass}
            value={block.props.ctaUrl}
            onChangeText={(value) => updateProps(block.id, { ctaUrl: value })}
            placeholder="https://..."
            placeholderTextColor="#555"
          />
        </View>
      );
    case 'social_proof':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Heading</Text>
          <TextInput
            className={inputClass}
            value={block.props.heading}
            onChangeText={(value) => updateProps(block.id, { heading: value })}
            placeholder="Trusted by"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">Logos (comma-separated names)</Text>
          <TextInput
            className={inputClass}
            value={block.props.logos.map((logo) => logo.name).join(', ')}
            onChangeText={(value) =>
              updateProps(block.id, {
                logos: value
                  .split(',')
                  .map((name) => ({ name: name.trim() }))
                  .filter((logo) => logo.name),
              })
            }
            placeholder="Acme, Globex, Initech"
            placeholderTextColor="#555"
          />
        </View>
      );
    case 'case_study':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Content Asset</Text>
          <View className="flex-row flex-wrap gap-1 mb-2">
            {assets
              .filter((asset) => asset.type === 'case_study')
              .map((asset) => (
                <Pressable
                  key={asset.id}
                  className={`px-2 py-1 rounded-lg ${
                    block.props.assetId === asset.id
                      ? 'bg-indigo-500/20 border border-indigo-500'
                      : 'bg-[#333] border border-[#444]'
                  }`}
                  onPress={() => updateProps(block.id, { assetId: asset.id })}
                >
                  <Text className="text-white text-xs">{asset.title}</Text>
                </Pressable>
              ))}
            {assets.filter((asset) => asset.type === 'case_study').length === 0 ? (
              <Text className="text-gray-500 text-xs">No case study assets. Add one above.</Text>
            ) : null}
          </View>
          <Text className="text-gray-400 text-xs">Override Title (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.overrideTitle || ''}
            onChangeText={(value) => updateProps(block.id, { overrideTitle: value || undefined })}
            placeholder="Override title"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">Override Metric (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.overrideMetric || ''}
            onChangeText={(value) => updateProps(block.id, { overrideMetric: value || undefined })}
            placeholder="Override metric"
            placeholderTextColor="#555"
          />
        </View>
      );
    case 'benefits':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Heading</Text>
          <TextInput
            className={inputClass}
            value={block.props.heading}
            onChangeText={(value) => updateProps(block.id, { heading: value })}
            placeholder="Benefits"
            placeholderTextColor="#555"
          />
          {block.props.items.map((item, index) => (
            <View key={index} className="flex-row gap-2 items-start">
              <View className="flex-1">
                <TextInput
                  className={inputClass}
                  value={item.title}
                  onChangeText={(value) => {
                    const items = [...block.props.items];
                    items[index] = { ...items[index], title: value };
                    updateProps(block.id, { items });
                  }}
                  placeholder={`Benefit ${index + 1} title`}
                  placeholderTextColor="#555"
                />
                <TextInput
                  className={inputClass}
                  value={item.description}
                  onChangeText={(value) => {
                    const items = [...block.props.items];
                    items[index] = { ...items[index], description: value };
                    updateProps(block.id, { items });
                  }}
                  placeholder="Description"
                  placeholderTextColor="#555"
                />
              </View>
              <Pressable
                className="mt-2"
                onPress={() =>
                  updateProps(block.id, {
                    items: block.props.items.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <Text className="text-red-400 text-sm">✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            className="border border-dashed border-[#444] rounded-lg p-2 items-center"
            onPress={() =>
              updateProps(block.id, {
                items: [...block.props.items, { title: '', description: '' }],
              })
            }
          >
            <Text className="text-gray-400 text-xs">+ Add benefit</Text>
          </Pressable>
        </View>
      );
    case 'testimonial':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Content Asset</Text>
          <View className="flex-row flex-wrap gap-1 mb-2">
            {assets
              .filter((asset) => asset.type === 'testimonial')
              .map((asset) => (
                <Pressable
                  key={asset.id}
                  className={`px-2 py-1 rounded-lg ${
                    block.props.assetId === asset.id
                      ? 'bg-indigo-500/20 border border-indigo-500'
                      : 'bg-[#333] border border-[#444]'
                  }`}
                  onPress={() => updateProps(block.id, { assetId: asset.id })}
                >
                  <Text className="text-white text-xs">{asset.title}</Text>
                </Pressable>
              ))}
            {assets.filter((asset) => asset.type === 'testimonial').length === 0 ? (
              <Text className="text-gray-500 text-xs">No testimonial assets. Add one above.</Text>
            ) : null}
          </View>
          <Text className="text-gray-400 text-xs">Override Quote (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.overrideQuote || ''}
            onChangeText={(value) => updateProps(block.id, { overrideQuote: value || undefined })}
            placeholder="Override quote"
            placeholderTextColor="#555"
            multiline
          />
          <Text className="text-gray-400 text-xs">Override Attribution (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.overrideAttribution || ''}
            onChangeText={(value) =>
              updateProps(block.id, { overrideAttribution: value || undefined })
            }
            placeholder="Override attribution"
            placeholderTextColor="#555"
          />
        </View>
      );
    case 'cta':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Headline</Text>
          <TextInput
            className={inputClass}
            value={block.props.headline}
            onChangeText={(value) => updateProps(block.id, { headline: value })}
            placeholder="Ready to get started?"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">CTA Text</Text>
          <TextInput
            className={inputClass}
            value={block.props.ctaText}
            onChangeText={(value) => updateProps(block.id, { ctaText: value })}
            placeholder="Book a call"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">CTA URL</Text>
          <TextInput
            className={inputClass}
            value={block.props.ctaUrl}
            onChangeText={(value) => updateProps(block.id, { ctaUrl: value })}
            placeholder="https://..."
            placeholderTextColor="#555"
          />
        </View>
      );
    case 'social_media_plan': {
      const props = block.props;
      return (
        <View className="gap-2">
          <Text className="text-gray-400 text-xs">Inferred vertical</Text>
          <TextInput
            className={inputClass}
            value={props.inferred_vertical}
            onChangeText={(value) => updateProps(block.id, { inferred_vertical: value })}
            placeholder="e.g. med spas"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">Vertical rationale</Text>
          <TextInput
            className={inputClass}
            value={props.inferred_vertical_rationale}
            onChangeText={(value) => updateProps(block.id, { inferred_vertical_rationale: value })}
            placeholder="Why this vertical (honest)"
            placeholderTextColor="#555"
            multiline
          />
          <Text className="text-gray-400 text-xs">Positioning summary</Text>
          <TextInput
            className={inputClass}
            value={props.positioning_summary}
            onChangeText={(value) => updateProps(block.id, { positioning_summary: value })}
            placeholder="How this vertical should sound on social"
            placeholderTextColor="#555"
            multiline
          />
          <Text className="text-gray-400 text-xs">Platform mix note</Text>
          <TextInput
            className={inputClass}
            value={props.platform_mix_note}
            onChangeText={(value) => updateProps(block.id, { platform_mix_note: value })}
            placeholder="One line on IG / TikTok / FB split"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">CTA ladder (one per line)</Text>
          <TextInput
            className={inputClass}
            value={props.cta_ladder.join('\n')}
            onChangeText={(value) =>
              updateProps(block.id, {
                cta_ladder: value.split('\n').map((s) => s.trim()).filter(Boolean),
              })
            }
            placeholder={'Follow\nDM KEYWORD\nBook consult'}
            placeholderTextColor="#555"
            multiline
          />
          {props.weeks.map((week, wi) => (
            <View key={wi} className="border border-[#333] rounded-lg p-3 gap-2">
              <Text className="text-gray-300 text-xs font-instrument-semibold">Week {wi + 1} theme</Text>
              <TextInput
                className={inputClass}
                value={week.theme}
                onChangeText={(value) => {
                  const weeks = [...props.weeks];
                  weeks[wi] = { ...weeks[wi]!, theme: value };
                  updateProps(block.id, { weeks });
                }}
                placeholder="Week theme"
                placeholderTextColor="#555"
              />
              {week.days.map((day, di) => (
                <View key={di} className="border border-[#2A2A2A] rounded-md p-2 gap-1">
                  <View className="flex-row justify-between items-center mb-1">
                    <Text className="text-gray-500 text-[10px] uppercase">Day {di + 1}</Text>
                    <Pressable
                      onPress={() => {
                        const weeks = [...props.weeks];
                        const w = { ...weeks[wi]!, days: week.days.filter((_, j) => j !== di) };
                        weeks[wi] = w;
                        updateProps(block.id, { weeks });
                      }}
                    >
                      <Text className="text-red-400 text-xs">Remove day</Text>
                    </Pressable>
                  </View>
                  <TextInput
                    className={inputClass}
                    value={day.platform}
                    onChangeText={(value) => {
                      const weeks = [...props.weeks];
                      const days = [...week.days];
                      days[di] = { ...days[di]!, platform: value };
                      weeks[wi] = { ...weeks[wi]!, days };
                      updateProps(block.id, { weeks });
                    }}
                    placeholder="IG / TikTok / FB"
                    placeholderTextColor="#555"
                  />
                  <TextInput
                    className={inputClass}
                    value={day.post_type}
                    onChangeText={(value) => {
                      const weeks = [...props.weeks];
                      const days = [...week.days];
                      days[di] = { ...days[di]!, post_type: value };
                      weeks[wi] = { ...weeks[wi]!, days };
                      updateProps(block.id, { weeks });
                    }}
                    placeholder="Reel, carousel, …"
                    placeholderTextColor="#555"
                  />
                  <TextInput
                    className={inputClass}
                    value={day.hook}
                    onChangeText={(value) => {
                      const weeks = [...props.weeks];
                      const days = [...week.days];
                      days[di] = { ...days[di]!, hook: value };
                      weeks[wi] = { ...weeks[wi]!, days };
                      updateProps(block.id, { weeks });
                    }}
                    placeholder="Hook"
                    placeholderTextColor="#555"
                    multiline
                  />
                  <TextInput
                    className={inputClass}
                    value={day.cta ?? ''}
                    onChangeText={(value) => {
                      const weeks = [...props.weeks];
                      const days = [...week.days];
                      days[di] = { ...days[di]!, cta: value.trim() ? value : undefined };
                      weeks[wi] = { ...weeks[wi]!, days };
                      updateProps(block.id, { weeks });
                    }}
                    placeholder="CTA (optional)"
                    placeholderTextColor="#555"
                  />
                </View>
              ))}
              <Pressable
                className="border border-dashed border-[#444] rounded-lg p-2 items-center"
                onPress={() => {
                  const weeks = [...props.weeks];
                  weeks[wi] = {
                    ...weeks[wi]!,
                    days: [
                      ...week.days,
                      { platform: '', post_type: '', hook: '' },
                    ],
                  };
                  updateProps(block.id, { weeks });
                }}
              >
                <Text className="text-gray-400 text-xs">+ Add day</Text>
              </Pressable>
              <Pressable
                className="mt-1"
                onPress={() =>
                  updateProps(block.id, {
                    weeks: props.weeks.filter((_, j) => j !== wi),
                  })
                }
              >
                <Text className="text-red-400 text-xs">Remove week {wi + 1}</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            className="border border-dashed border-[#444] rounded-lg p-2 items-center"
            onPress={() =>
              updateProps(block.id, {
                weeks: [
                  ...props.weeks,
                  { theme: '', days: [{ platform: '', post_type: '', hook: '' }] },
                ],
              })
            }
          >
            <Text className="text-gray-400 text-xs">+ Add week</Text>
          </Pressable>
        </View>
      );
    }
    case 'tanners_tax_strategy':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Heading</Text>
          <TextInput
            className={inputClass}
            value={block.props.heading}
            onChangeText={(value) => updateProps(block.id, { heading: value })}
            placeholder="Heading"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">Subheadline (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.subheadline || ''}
            onChangeText={(value) => updateProps(block.id, { subheadline: value || undefined })}
            placeholder="Short intro"
            placeholderTextColor="#555"
            multiline
          />
          <Text className="text-gray-400 text-xs">Disclaimer</Text>
          <TextInput
            className={inputClass}
            value={block.props.disclaimer}
            onChangeText={(value) => updateProps(block.id, { disclaimer: value })}
            placeholder="Legal disclaimer"
            placeholderTextColor="#555"
            multiline
          />
          <Text className="text-gray-400 text-xs">Default purchase price</Text>
          <TextInput
            className={inputClass}
            value={
              block.props.defaultPurchasePrice != null ? String(block.props.defaultPurchasePrice) : ''
            }
            onChangeText={(value) => {
              const parsed = parseFloat(value.replace(/,/g, ''));
              updateProps(block.id, {
                defaultPurchasePrice:
                  value.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed,
              });
            }}
            placeholder="500000"
            placeholderTextColor="#555"
            keyboardType="decimal-pad"
          />
          <Text className="text-gray-400 text-xs">Default land value</Text>
          <TextInput
            className={inputClass}
            value={block.props.defaultLandValue != null ? String(block.props.defaultLandValue) : ''}
            onChangeText={(value) => {
              const parsed = parseFloat(value.replace(/,/g, ''));
              updateProps(block.id, {
                defaultLandValue:
                  value.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed,
              });
            }}
            placeholder="150000"
            placeholderTextColor="#555"
            keyboardType="decimal-pad"
          />
          <Text className="text-gray-400 text-xs">Default marginal tax %</Text>
          <TextInput
            className={inputClass}
            value={
              block.props.defaultMarginalTaxPercent != null
                ? String(block.props.defaultMarginalTaxPercent)
                : ''
            }
            onChangeText={(value) => {
              const parsed = parseFloat(value.replace(/,/g, ''));
              updateProps(block.id, {
                defaultMarginalTaxPercent:
                  value.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed,
              });
            }}
            placeholder="37"
            placeholderTextColor="#555"
            keyboardType="decimal-pad"
          />
          <Text className="text-gray-400 text-xs mb-1">Default qualification mode</Text>
          <View className="flex-row flex-wrap gap-2 mb-2">
            {(['passive', 'reps', 'str'] as const).map((mode) => (
              <Pressable
                key={mode}
                className={`px-2 py-1 rounded-lg border ${
                  (block.props.defaultQualificationMode ?? 'passive') === mode
                    ? 'border-indigo-500 bg-indigo-500/20'
                    : 'border-[#444] bg-[#333]'
                }`}
                onPress={() => updateProps(block.id, { defaultQualificationMode: mode })}
              >
                <Text className="text-white text-xs">{mode}</Text>
              </Pressable>
            ))}
          </View>
          <Text className="text-gray-400 text-xs">CTA text (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.ctaText || ''}
            onChangeText={(value) => updateProps(block.id, { ctaText: value || undefined })}
            placeholder="Book a call"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs">CTA URL (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.ctaUrl || ''}
            onChangeText={(value) => updateProps(block.id, { ctaUrl: value || undefined })}
            placeholder="https://..."
            placeholderTextColor="#555"
          />
        </View>
      );
    default:
      return null;
  }
}
