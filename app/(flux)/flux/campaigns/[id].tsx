import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Button } from '@/components/ui/button';
import {
  getFluxCampaignById,
  updateFluxCampaign,
  deleteFluxCampaign,
  getFluxTemplate,
  upsertFluxTemplate,
  getFluxProspects,
  ensureFluxTemplateExists,
} from '@/lib/supabase/services/flux';
import type {
  FluxCampaignRow,
  FluxProspectRow,
  FluxPreviewProspectInput,
  PageConfig,
  Block,
  BlockType,
  ContentAsset,
} from '@/lib/flux/types';
import {
  FluxEditorSplitLayout,
  FluxEditorModeTabs,
  FluxChatPanel,
  FluxTemplateBlocksDraggableList,
  type FluxEditorPanelMode,
} from '@/components/flux';
import {
  fluxCampaignEditorReducer,
  initialFluxCampaignEditorState,
} from '@/lib/flux/editor/reducer';
import { callFluxEditorChat } from '@/lib/flux/callFluxEditorChat';
import { getFluxEditorChatUrl } from '@/lib/flux/fluxEditorChatUrl';
import { FluxFontFamilyPicker } from '@/components/flux/FluxFontFamilyPicker';
import { FluxGoogleFontWebLinks } from '@/components/flux/FluxGoogleFontWebLinks';
import { PageRenderer } from '@/components/flux/PageRenderer';
import { FLUX_GOOGLE_FONT_NAMES } from '@/lib/flux/googleFontsCatalog';
import { callFluxPreviewGenerate } from '@/lib/flux/callFluxGenerate';
import { getFluxGenerateUrl } from '@/lib/flux/fluxGenerateUrl';
import {
  applyLocalPreviewPatches,
  defaultFluxPreviewProspect,
  getFluxAiTierSnapshot,
} from '@/lib/flux/fluxCampaignPreview';

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  hero: 'Hero',
  social_proof: 'Social Proof',
  case_study: 'Case Study',
  benefits: 'Benefits',
  testimonial: 'Testimonial',
  cta: 'CTA',
  tanners_tax_strategy: 'Tax strategy calculator',
};

const ALL_BLOCK_TYPES: BlockType[] = [
  'hero',
  'social_proof',
  'case_study',
  'benefits',
  'testimonial',
  'cta',
  'tanners_tax_strategy',
];

function blockSummary(block: Block): string {
  switch (block.type) {
    case 'hero': return block.props.headline || '(empty headline)';
    case 'social_proof': return `${block.props.logos.length} logos`;
    case 'case_study': return block.props.overrideTitle || `asset: ${block.props.assetId || '(none)'}`;
    case 'benefits': return `${block.props.items.length} items`;
    case 'testimonial': return block.props.overrideQuote?.slice(0, 40) || `asset: ${block.props.assetId || '(none)'}`;
    case 'cta': return block.props.headline || '(empty)';
    case 'tanners_tax_strategy': return block.props.heading || '(calculator)';
  }
}

export default function CampaignDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<FluxCampaignRow | null>(null);
  const [prospects, setProspects] = useState<FluxProspectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorPanelMode, setEditorPanelMode] = useState<FluxEditorPanelMode>('manual');

  const [editor, dispatch] = useReducer(
    fluxCampaignEditorReducer,
    undefined as never,
    () => initialFluxCampaignEditorState(defaultFluxPreviewProspect()),
  );

  const [previewPageConfig, setPreviewPageConfig] = useState<PageConfig | null>(null);
  const [previewAiLoading, setPreviewAiLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [needsAiRerender, setNeedsAiRerender] = useState(false);

  const previewSeedForLoadRef = useRef(false);
  const initialAiTierRef = useRef<string | null>(null);
  const lastAiTierRef = useRef<string | null>(null);

  const copySlotsList = useMemo(
    () => editor.copySlots.split(',').map((s) => s.trim()).filter(Boolean),
    [editor.copySlots],
  );

  const previewProspectSerialized = useMemo(
    () => JSON.stringify(editor.previewProspect),
    [editor.previewProspect],
  );

  // Asset editor state
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetTitle, setAssetTitle] = useState('');
  const [assetBody, setAssetBody] = useState('');
  const [assetMetric, setAssetMetric] = useState('');
  const [assetAttribution, setAssetAttribution] = useState('');
  const [assetType, setAssetType] = useState<'case_study' | 'testimonial' | 'stat'>('case_study');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [c, t, p] = await Promise.all([
        getFluxCampaignById(id),
        getFluxTemplate(id),
        getFluxProspects(id),
      ]);
      if (!c) { router.back(); return; }
      setCampaign(c);
      setProspects(p);
      const templateRow = t ?? (await ensureFluxTemplateExists(id));
      dispatch({
        type: 'hydrate',
        payload: {
          name: c.name,
          offerDescription: c.offer_description || '',
          blocks: templateRow.blocks,
          contentAssets: templateRow.content_assets,
          copySlots: templateRow.copy_slots.join(', '),
          constraints: templateRow.constraints,
        },
      });
    } finally {
      setLoading(false);
    }
  }, [id, dispatch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (loading) {
      previewSeedForLoadRef.current = false;
      return;
    }
    if (!id || previewSeedForLoadRef.current) return;
    previewSeedForLoadRef.current = true;
    lastAiTierRef.current = null;
    initialAiTierRef.current = getFluxAiTierSnapshot({
      prospect: editor.previewProspect,
      copy_slots: copySlotsList,
      constraints: editor.constraints,
      content_assets: editor.contentAssets,
      blocks: editor.blocks,
    });
    setNeedsAiRerender(false);
  }, [loading, id, editor.blocks, editor.contentAssets, copySlotsList, editor.constraints, editor.previewProspect]);

  useEffect(() => {
    if (loading || !id || !previewSeedForLoadRef.current) return;
    const cur = getFluxAiTierSnapshot({
      prospect: editor.previewProspect,
      copy_slots: copySlotsList,
      constraints: editor.constraints,
      content_assets: editor.contentAssets,
      blocks: editor.blocks,
    });
    const baseline = lastAiTierRef.current ?? initialAiTierRef.current;
    if (baseline === null) return;
    setNeedsAiRerender(cur !== baseline);
  }, [
    loading,
    id,
    editor.blocks,
    editor.contentAssets,
    copySlotsList,
    editor.constraints,
    previewProspectSerialized,
  ]);

  useEffect(() => {
    if (loading || !id || previewAiLoading) return;
    setPreviewPageConfig((prev) =>
      applyLocalPreviewPatches(prev, editor.previewProspect, editor.blocks, {
        syncBlocksFromTemplate: !needsAiRerender,
      }),
    );
  }, [loading, id, previewProspectSerialized, editor.blocks, needsAiRerender, previewAiLoading]);

  const patchPreviewProspect = useCallback((patch: Partial<FluxPreviewProspectInput>) => {
    dispatch({ type: 'preview.patchProspect', patch });
  }, []);

  const patchPreviewBrand = useCallback((patch: { primaryColor?: string; accentColor?: string; fontFamily?: string; logoUrl?: string }) => {
    dispatch({ type: 'preview.patchBrand', patch });
  }, []);

  const handleRerenderWithAi = useCallback(async () => {
    if (!id || previewAiLoading || editor.blocks.length === 0) return;
    if (!getFluxGenerateUrl()) {
      Alert.alert(
        'Preview AI unavailable',
        'Configure the Flux generate URL (amplify_outputs / EXPO_PUBLIC_FLUX_GENERATE_URL) and restart Expo.',
      );
      return;
    }
    setPreviewAiLoading(true);
    setPreviewError(null);
    try {
      const result = await callFluxPreviewGenerate({
        campaignId: id,
        prospect: editor.previewProspect,
        template: {
          blocks: editor.blocks,
          content_assets: editor.contentAssets,
          copy_slots: copySlotsList,
          constraints: editor.constraints,
        },
      });
      if (!result.ok) {
        setPreviewError(result.message);
        Alert.alert(
          'Rerender with AI',
          `${result.message}\n\nThe preview was not updated. After a successful run, AI-filled copy replaces empty blocks in the preview.`,
        );
        return;
      }
      // Clone so preview + reducer do not share mutable refs with the fetch JSON.
      // Apply synchronously after await (React 18+ batches these). Do NOT defer with queueMicrotask:
      // `finally { setPreviewAiLoading(false) }` runs before queued microtasks, so a commit could fire
      // with loading cleared while `editor.blocks` was still empty — the preview effect then synced
      // template blocks and wiped the AI copy.
      const mergedBlocks = JSON.parse(JSON.stringify(result.pageConfig.blocks)) as Block[];
      const nextPageConfig: PageConfig = { ...result.pageConfig, blocks: mergedBlocks };
      dispatch({ type: 'block.setBlocks', blocks: mergedBlocks });
      setPreviewPageConfig(nextPageConfig);
      const snap = getFluxAiTierSnapshot({
        prospect: editor.previewProspect,
        copy_slots: copySlotsList,
        constraints: editor.constraints,
        content_assets: editor.contentAssets,
        blocks: mergedBlocks,
      });
      lastAiTierRef.current = snap;
      initialAiTierRef.current = snap;
      setNeedsAiRerender(false);
    } finally {
      setPreviewAiLoading(false);
    }
  }, [
    id,
    previewAiLoading,
    dispatch,
    editor.previewProspect,
    editor.blocks,
    editor.contentAssets,
    copySlotsList,
    editor.constraints,
  ]);

  const handleChatSend = useCallback(
    async (text: string) => {
      if (!id) return;
      const transcript = [
        ...editor.chatMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: text },
      ];
      dispatch({
        type: 'chat.appendUser',
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: text,
      });
      dispatch({ type: 'chat.setSending', value: true });
      dispatch({ type: 'chat.setError', value: null });
      try {
        const result = await callFluxEditorChat({
          campaignId: id,
          messages: transcript,
          editor: {
            name: editor.name,
            offer_description: editor.offerDescription,
            blocks: editor.blocks,
            content_assets: editor.contentAssets,
            copy_slots: copySlotsList,
            constraints: editor.constraints,
            preview_prospect: editor.previewProspect,
          },
        });
        if (!result.ok) {
          dispatch({ type: 'chat.setError', value: result.message });
          dispatch({
            type: 'chat.appendAssistant',
            id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            content: `Sorry — ${result.message}`,
          });
          return;
        }
        if (result.data.operations.length > 0) {
          dispatch({ type: 'chat.applyRemoteOperations', operations: result.data.operations });
        }
        dispatch({
          type: 'chat.appendAssistant',
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          content: result.data.assistantMessage,
          summary: result.data.summary,
        });
      } finally {
        dispatch({ type: 'chat.setSending', value: false });
      }
    },
    [id, editor],
  );

  const handleSave = async () => {
    if (!id || saving) return;
    setSaving(true);
    try {
      await updateFluxCampaign(id, {
        name: editor.name,
        offer_description: editor.offerDescription || null,
      });
      await upsertFluxTemplate(id, {
        blocks: editor.blocks,
        content_assets: editor.contentAssets,
        copy_slots: editor.copySlots.split(',').map((s) => s.trim()).filter(Boolean),
        constraints: editor.constraints,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!id) return;
    Alert.alert('Delete Campaign', 'This will delete all prospects and pages for this campaign.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteFluxCampaign(id);
          router.replace('/flux' as Href);
        },
      },
    ]);
  };

  const addBlock = (type: BlockType) => {
    dispatch({ type: 'block.add', blockType: type });
  };

  const removeBlock = (blockId: string) => {
    dispatch({ type: 'block.remove', blockId });
  };

  const updateBlockProps = (blockId: string, newProps: Record<string, unknown>) => {
    dispatch({ type: 'block.updateProps', blockId, props: newProps });
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

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#6b7280" />
      </View>
    );
  }

  const fluxGenerateConfigured = Boolean(getFluxGenerateUrl());
  const fluxEditorChatConfigured = Boolean(getFluxEditorChatUrl());
  const showPreviewAiOverlay = editor.blocks.length > 0 && (needsAiRerender || previewAiLoading);

  return (
    <>
      <FluxGoogleFontWebLinks families={FLUX_GOOGLE_FONT_NAMES} />
    <FluxEditorSplitLayout
      editorScrollable={editorPanelMode !== 'chat'}
      editorNestableScroll
      header={(
        <View className="px-4 pt-2 pb-3 border-b border-[#2A2A2A]">
          <View className="flex-row items-center justify-between">
            <Pressable onPress={() => router.back()}>
              <Text className="text-gray-400 text-sm font-instrument">← Back</Text>
            </Pressable>
            <View className="flex-row gap-2">
              <Button size="sm" variant="destructive" onPress={handleDelete}>Delete</Button>
              <Button size="sm" onPress={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
            </View>
          </View>
        </View>
      )}
      editor={editorPanelMode === 'chat' ? (
        <View className="flex-1" style={{ minHeight: 0 }}>
          <FluxEditorModeTabs mode={editorPanelMode} onModeChange={setEditorPanelMode} />
          <FluxChatPanel
            messages={editor.chatMessages}
            lastSummary={editor.chatLastSummary}
            sending={editor.chatSending}
            error={editor.chatError}
            canUndo={!!editor.chatUndoSnapshot}
            chatConfigured={fluxEditorChatConfigured}
            onSend={handleChatSend}
            onUndo={() => dispatch({ type: 'chat.undoLast' })}
          />
        </View>
      ) : (
        <>
      <FluxEditorModeTabs mode={editorPanelMode} onModeChange={setEditorPanelMode} />
      <Text className="text-gray-500 text-xs uppercase tracking-wider mb-2 font-instrument-semibold">Campaign</Text>
      <TextInput
        className="text-white text-xl font-instrument-semibold bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 mb-3"
        value={editor.name}
        onChangeText={(v) => dispatch({ type: 'campaign.setName', value: v })}
        placeholder="Campaign name"
        placeholderTextColor="#555"
      />
      <TextInput
        className="text-gray-300 text-sm font-instrument bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 mb-6"
        value={editor.offerDescription}
        onChangeText={(v) => dispatch({ type: 'campaign.setOfferDescription', value: v })}
        placeholder="Offer description"
        placeholderTextColor="#555"
        multiline
      />

      <Pressable
        className="mb-3 border border-[#2A2A2A] rounded-xl px-3 py-2 bg-[#1A1A1A]"
        onPress={() => dispatch({ type: 'ui.setPreviewProspectOpen', value: !editor.previewProspectOpen })}
      >
        <Text className="text-gray-400 text-sm font-instrument">
          {editor.previewProspectOpen ? '▾' : '▸'} Preview prospect (not saved — for editor preview only)
        </Text>
      </Pressable>
      {editor.previewProspectOpen ? (
        <View className="mb-6 border border-[#2A2A2A] rounded-xl p-4 bg-[#1A1A1A] gap-1">
          <Text className="text-gray-400 text-xs font-instrument mb-2">Theme updates live; other changes may need Rerender with AI in the preview panel.</Text>
          <Text className="text-gray-400 text-xs font-instrument mb-1">Contact name</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.name}
            onChangeText={(v) => patchPreviewProspect({ name: v })}
            placeholder="Jane Smith"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Company</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.company}
            onChangeText={(v) => patchPreviewProspect({ company: v })}
            placeholder="Acme Corp"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Role</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.role ?? ''}
            onChangeText={(v) => patchPreviewProspect({ role: v })}
            placeholder="VP of Sales"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Company URL</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.url ?? ''}
            onChangeText={(v) => patchPreviewProspect({ url: v })}
            placeholder="https://acme.com"
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Industry</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.industry ?? ''}
            onChangeText={(v) => patchPreviewProspect({ industry: v })}
            placeholder="SaaS"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Company size</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.company_size ?? ''}
            onChangeText={(v) => patchPreviewProspect({ company_size: v })}
            placeholder="50-200"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-400 text-xs font-instrument mb-1">Email notes</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-3 min-h-[72px]"
            value={editor.previewProspect.email_notes ?? ''}
            onChangeText={(v) => patchPreviewProspect({ email_notes: v })}
            placeholder="Context for the model…"
            placeholderTextColor="#555"
            multiline
            textAlignVertical="top"
          />
          <Text className="text-gray-500 text-xs uppercase tracking-wider mb-2 font-instrument-semibold">Brand</Text>
          <Text className="text-gray-400 text-xs font-instrument mb-1">Primary color</Text>
          <View className="flex-row items-center gap-2 mb-2">
            <View className="w-7 h-7 rounded-md border border-[#444]" style={{ backgroundColor: editor.previewProspect.brand_profile?.primaryColor ?? '#4f46e5' }} />
            <TextInput
              className="flex-1 text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2"
              value={editor.previewProspect.brand_profile?.primaryColor ?? '#4f46e5'}
              onChangeText={(v) => patchPreviewBrand({ primaryColor: v })}
              placeholder="#4f46e5"
              placeholderTextColor="#555"
              autoCapitalize="none"
            />
          </View>
          <Text className="text-gray-400 text-xs font-instrument mb-1">Accent (optional)</Text>
          <TextInput
            className="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
            value={editor.previewProspect.brand_profile?.accentColor ?? ''}
            onChangeText={(v) => patchPreviewBrand({ accentColor: v || undefined })}
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
            onChangeText={(v) => patchPreviewBrand({ logoUrl: v || undefined })}
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
                    brand_profile: sample.brand_profile ?? defaultFluxPreviewProspect().brand_profile,
                  },
                });
              }}
            >
              Fill from first prospect ({prospects[0].name})
            </Button>
          ) : null}
        </View>
      ) : null}

      <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 font-instrument-semibold">Template Blocks</Text>
      {editor.blocks.length === 0 ? (
        <View className="border border-[#2A2A2A] rounded-xl p-4 mb-3">
          <Text className="text-gray-400 text-sm font-instrument text-center">No blocks yet. Add one below.</Text>
        </View>
      ) : (
        <View className="mb-3">
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
        </View>
      )}
      <View className="flex-row flex-wrap gap-2 mb-8">
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

      {/* Content assets */}
      <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 font-instrument-semibold">Content Assets</Text>
      {editor.contentAssets.length > 0 && (
        <View className="gap-2 mb-3">
          {editor.contentAssets.map((asset) => (
            <View key={asset.id} className="border border-[#2A2A2A] rounded-xl p-3 bg-[#1A1A1A] flex-row items-center">
              <View className="flex-1">
                <Text className="text-white text-sm font-instrument-semibold">{asset.title}</Text>
                <Text className="text-gray-400 text-xs font-instrument">{asset.type}{asset.metric ? ` · ${asset.metric}` : ''}</Text>
              </View>
              <Pressable onPress={() => removeAsset(asset.id)}>
                <Text className="text-red-400 text-sm">✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {showAssetForm ? (
        <View className="border border-[#2A2A2A] rounded-xl p-4 bg-[#1A1A1A] mb-6 gap-3">
          <View className="flex-row gap-2">
            {(['case_study', 'testimonial', 'stat'] as const).map((t) => (
              <Pressable
                key={t}
                className={`px-3 py-1 rounded-lg ${assetType === t ? 'bg-indigo-500/20 border border-indigo-500' : 'bg-[#2A2A2A] border border-[#3A3A3A]'}`}
                onPress={() => setAssetType(t)}
              >
                <Text className="text-white text-xs font-instrument">{t.replace('_', ' ')}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm" placeholder="Title" placeholderTextColor="#555" value={assetTitle} onChangeText={setAssetTitle} />
          <TextInput className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm" placeholder="Body" placeholderTextColor="#555" value={assetBody} onChangeText={setAssetBody} multiline />
          <TextInput className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm" placeholder="Metric (optional)" placeholderTextColor="#555" value={assetMetric} onChangeText={setAssetMetric} />
          <TextInput className="text-white bg-[#222] border border-[#333] rounded-lg px-3 py-2 text-sm" placeholder="Attribution (optional)" placeholderTextColor="#555" value={assetAttribution} onChangeText={setAssetAttribution} />
          <View className="flex-row gap-2">
            <Button size="sm" onPress={addAsset}>Add Asset</Button>
            <Button size="sm" variant="secondary" onPress={() => setShowAssetForm(false)}>Cancel</Button>
          </View>
        </View>
      ) : (
        <Pressable className="border border-dashed border-[#3A3A3A] rounded-xl p-3 mb-6 items-center" onPress={() => setShowAssetForm(true)}>
          <Text className="text-gray-400 text-sm font-instrument">+ Add content asset</Text>
        </Pressable>
      )}

      {/* LLM config */}
      <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 font-instrument-semibold">LLM Configuration</Text>
      <Text className="text-gray-400 text-xs font-instrument mb-1">Copy slots (comma-separated field names the LLM may rewrite)</Text>
      <TextInput
        className="text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm mb-3"
        value={editor.copySlots}
        onChangeText={(v) => dispatch({ type: 'template.setCopySlotsText', value: v })}
        placeholder="headline, subheadline, ctaText"
        placeholderTextColor="#555"
      />
      <Text className="text-gray-400 text-xs font-instrument mb-1">Constraints (rules for the LLM)</Text>
      <TextInput
        className="text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm mb-8"
        value={editor.constraints}
        onChangeText={(v) => dispatch({ type: 'template.setConstraints', value: v })}
        placeholder="Always end with a CTA. Keep headlines under 10 words."
        placeholderTextColor="#555"
        multiline
      />

      {/* Prospects */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-gray-500 text-xs uppercase tracking-wider font-instrument-semibold">Prospects</Text>
        <Button
          size="xs"
          onPress={() => router.push(`/flux/prospects/new?campaignId=${id}` as Href)}
        >
          + New Prospect
        </Button>
      </View>
      {prospects.length === 0 ? (
        <View className="border border-[#2A2A2A] rounded-xl p-4 items-center">
          <Text className="text-gray-400 text-sm font-instrument">No prospects yet for this campaign.</Text>
        </View>
      ) : (
        <View className="gap-2">
          {prospects.map((p) => (
            <Pressable
              key={p.id}
              className="border border-[#2A2A2A] rounded-xl p-3 bg-[#1A1A1A]"
              onPress={() => router.push(`/flux/prospects/${p.id}` as Href)}
            >
              <Text className="text-white text-sm font-instrument-semibold">{p.name}</Text>
              <Text className="text-gray-400 text-xs font-instrument">{p.company}{p.role ? ` · ${p.role}` : ''}</Text>
            </Pressable>
          ))}
        </View>
      )}
        </>
      )}
      preview={(
        previewPageConfig ? (
          <PageRenderer
            config={previewPageConfig}
            assets={editor.contentAssets}
            scrollable={false}
            highlightedBlockId={editor.editingBlockId}
          />
        ) : (
          <View className="py-12 px-6 items-center justify-center min-h-[200px]">
            <Text className="text-gray-500 text-sm font-instrument text-center">
              Add blocks to see a live preview.
            </Text>
          </View>
        )
      )}
      previewOverlay={(
        showPreviewAiOverlay ? (
          <View className="items-center max-w-xs">
            {previewAiLoading ? (
              <ActivityIndicator size="large" color="#e5e7eb" />
            ) : null}
            <Text className="text-white text-center text-sm font-instrument-semibold mt-3 mb-1">
              Rerender with AI
            </Text>
            <Text className="text-gray-300 text-center text-xs font-instrument leading-5 mb-4">
              Prospect or template changes need a fresh personalization pass.
            </Text>
            {!fluxGenerateConfigured ? (
              <Text className="text-amber-200/90 text-xs font-instrument text-center mb-3">
                Flux generate URL is not configured. Set amplify_outputs / EXPO_PUBLIC_FLUX_GENERATE_URL and restart Expo.
              </Text>
            ) : null}
            {previewError && !previewAiLoading ? (
              <Text className="text-red-300 text-xs font-instrument text-center mb-3">{previewError}</Text>
            ) : null}
            <Button
              size="sm"
              onPress={handleRerenderWithAi}
              disabled={previewAiLoading || !fluxGenerateConfigured}
            >
              {previewAiLoading ? 'Generating…' : 'Rerender with AI'}
            </Button>
          </View>
        ) : undefined
      )}
    />
    </>
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
          <TextInput className={inputClass} value={block.props.headline} onChangeText={(v) => updateProps(block.id, { headline: v })} placeholder="Headline" placeholderTextColor="#555" />
          <Text className="text-gray-400 text-xs">Subheadline</Text>
          <TextInput className={inputClass} value={block.props.subheadline} onChangeText={(v) => updateProps(block.id, { subheadline: v })} placeholder="Subheadline" placeholderTextColor="#555" multiline />
          <Text className="text-gray-400 text-xs">CTA Text</Text>
          <TextInput className={inputClass} value={block.props.ctaText} onChangeText={(v) => updateProps(block.id, { ctaText: v })} placeholder="CTA text" placeholderTextColor="#555" />
          <Text className="text-gray-400 text-xs">CTA URL</Text>
          <TextInput className={inputClass} value={block.props.ctaUrl} onChangeText={(v) => updateProps(block.id, { ctaUrl: v })} placeholder="https://..." placeholderTextColor="#555" />
        </View>
      );
    case 'social_proof':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Heading</Text>
          <TextInput className={inputClass} value={block.props.heading} onChangeText={(v) => updateProps(block.id, { heading: v })} placeholder="Trusted by" placeholderTextColor="#555" />
          <Text className="text-gray-400 text-xs">Logos (comma-separated names)</Text>
          <TextInput
            className={inputClass}
            value={block.props.logos.map((l) => l.name).join(', ')}
            onChangeText={(v) => updateProps(block.id, { logos: v.split(',').map((n) => ({ name: n.trim() })).filter((l) => l.name) })}
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
            {assets.filter((a) => a.type === 'case_study').map((a) => (
              <Pressable
                key={a.id}
                className={`px-2 py-1 rounded-lg ${block.props.assetId === a.id ? 'bg-indigo-500/20 border border-indigo-500' : 'bg-[#333] border border-[#444]'}`}
                onPress={() => updateProps(block.id, { assetId: a.id })}
              >
                <Text className="text-white text-xs">{a.title}</Text>
              </Pressable>
            ))}
            {assets.filter((a) => a.type === 'case_study').length === 0 && (
              <Text className="text-gray-500 text-xs">No case study assets. Add one above.</Text>
            )}
          </View>
          <Text className="text-gray-400 text-xs">Override Title (optional)</Text>
          <TextInput className={inputClass} value={block.props.overrideTitle || ''} onChangeText={(v) => updateProps(block.id, { overrideTitle: v || undefined })} placeholder="Override title" placeholderTextColor="#555" />
          <Text className="text-gray-400 text-xs">Override Metric (optional)</Text>
          <TextInput className={inputClass} value={block.props.overrideMetric || ''} onChangeText={(v) => updateProps(block.id, { overrideMetric: v || undefined })} placeholder="Override metric" placeholderTextColor="#555" />
        </View>
      );
    case 'benefits':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Heading</Text>
          <TextInput className={inputClass} value={block.props.heading} onChangeText={(v) => updateProps(block.id, { heading: v })} placeholder="Benefits" placeholderTextColor="#555" />
          {block.props.items.map((item, i) => (
            <View key={i} className="flex-row gap-2 items-start">
              <View className="flex-1">
                <TextInput className={inputClass} value={item.title} onChangeText={(v) => { const items = [...block.props.items]; items[i] = { ...items[i], title: v }; updateProps(block.id, { items }); }} placeholder={`Benefit ${i + 1} title`} placeholderTextColor="#555" />
                <TextInput className={inputClass} value={item.description} onChangeText={(v) => { const items = [...block.props.items]; items[i] = { ...items[i], description: v }; updateProps(block.id, { items }); }} placeholder="Description" placeholderTextColor="#555" />
              </View>
              <Pressable className="mt-2" onPress={() => { const items = block.props.items.filter((_, j) => j !== i); updateProps(block.id, { items }); }}>
                <Text className="text-red-400 text-sm">✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            className="border border-dashed border-[#444] rounded-lg p-2 items-center"
            onPress={() => updateProps(block.id, { items: [...block.props.items, { title: '', description: '' }] })}
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
            {assets.filter((a) => a.type === 'testimonial').map((a) => (
              <Pressable
                key={a.id}
                className={`px-2 py-1 rounded-lg ${block.props.assetId === a.id ? 'bg-indigo-500/20 border border-indigo-500' : 'bg-[#333] border border-[#444]'}`}
                onPress={() => updateProps(block.id, { assetId: a.id })}
              >
                <Text className="text-white text-xs">{a.title}</Text>
              </Pressable>
            ))}
            {assets.filter((a) => a.type === 'testimonial').length === 0 && (
              <Text className="text-gray-500 text-xs">No testimonial assets. Add one above.</Text>
            )}
          </View>
          <Text className="text-gray-400 text-xs">Override Quote (optional)</Text>
          <TextInput className={inputClass} value={block.props.overrideQuote || ''} onChangeText={(v) => updateProps(block.id, { overrideQuote: v || undefined })} placeholder="Override quote" placeholderTextColor="#555" multiline />
          <Text className="text-gray-400 text-xs">Override Attribution (optional)</Text>
          <TextInput className={inputClass} value={block.props.overrideAttribution || ''} onChangeText={(v) => updateProps(block.id, { overrideAttribution: v || undefined })} placeholder="Override attribution" placeholderTextColor="#555" />
        </View>
      );
    case 'cta':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Headline</Text>
          <TextInput className={inputClass} value={block.props.headline} onChangeText={(v) => updateProps(block.id, { headline: v })} placeholder="Ready to get started?" placeholderTextColor="#555" />
          <Text className="text-gray-400 text-xs">CTA Text</Text>
          <TextInput className={inputClass} value={block.props.ctaText} onChangeText={(v) => updateProps(block.id, { ctaText: v })} placeholder="Book a Call" placeholderTextColor="#555" />
          <Text className="text-gray-400 text-xs">CTA URL</Text>
          <TextInput className={inputClass} value={block.props.ctaUrl} onChangeText={(v) => updateProps(block.id, { ctaUrl: v })} placeholder="https://..." placeholderTextColor="#555" />
        </View>
      );
    case 'tanners_tax_strategy':
      return (
        <View className="gap-1">
          <Text className="text-gray-400 text-xs">Heading</Text>
          <TextInput className={inputClass} value={block.props.heading} onChangeText={(v) => updateProps(block.id, { heading: v })} placeholder="Heading" placeholderTextColor="#555" />
          <Text className="text-gray-400 text-xs">Subheadline (optional)</Text>
          <TextInput className={inputClass} value={block.props.subheadline || ''} onChangeText={(v) => updateProps(block.id, { subheadline: v || undefined })} placeholder="Short intro" placeholderTextColor="#555" multiline />
          <Text className="text-gray-400 text-xs">Disclaimer</Text>
          <TextInput className={inputClass} value={block.props.disclaimer} onChangeText={(v) => updateProps(block.id, { disclaimer: v })} placeholder="Legal disclaimer" placeholderTextColor="#555" multiline />
          <Text className="text-gray-400 text-xs">Default purchase price</Text>
          <TextInput
            className={inputClass}
            value={block.props.defaultPurchasePrice != null ? String(block.props.defaultPurchasePrice) : ''}
            onChangeText={(v) => {
              const n = parseFloat(v.replace(/,/g, ''));
              updateProps(block.id, { defaultPurchasePrice: v.trim() === '' || !Number.isFinite(n) ? undefined : n });
            }}
            placeholder="500000"
            placeholderTextColor="#555"
            keyboardType="decimal-pad"
          />
          <Text className="text-gray-400 text-xs">Default land value</Text>
          <TextInput
            className={inputClass}
            value={block.props.defaultLandValue != null ? String(block.props.defaultLandValue) : ''}
            onChangeText={(v) => {
              const n = parseFloat(v.replace(/,/g, ''));
              updateProps(block.id, { defaultLandValue: v.trim() === '' || !Number.isFinite(n) ? undefined : n });
            }}
            placeholder="150000"
            placeholderTextColor="#555"
            keyboardType="decimal-pad"
          />
          <Text className="text-gray-400 text-xs">Default marginal tax %</Text>
          <TextInput
            className={inputClass}
            value={block.props.defaultMarginalTaxPercent != null ? String(block.props.defaultMarginalTaxPercent) : ''}
            onChangeText={(v) => {
              const n = parseFloat(v.replace(/,/g, ''));
              updateProps(block.id, { defaultMarginalTaxPercent: v.trim() === '' || !Number.isFinite(n) ? undefined : n });
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
                className={`px-2 py-1 rounded-lg border ${(block.props.defaultQualificationMode ?? 'passive') === mode ? 'border-indigo-500 bg-indigo-500/20' : 'border-[#444] bg-[#333]'}`}
                onPress={() => updateProps(block.id, { defaultQualificationMode: mode })}
              >
                <Text className="text-white text-xs">{mode}</Text>
              </Pressable>
            ))}
          </View>
          <Text className="text-gray-400 text-xs">CTA text (optional)</Text>
          <TextInput className={inputClass} value={block.props.ctaText || ''} onChangeText={(v) => updateProps(block.id, { ctaText: v || undefined })} placeholder="Book a call" placeholderTextColor="#555" />
          <Text className="text-gray-400 text-xs">CTA URL (optional)</Text>
          <TextInput className={inputClass} value={block.props.ctaUrl || ''} onChangeText={(v) => updateProps(block.id, { ctaUrl: v || undefined })} placeholder="https://..." placeholderTextColor="#555" />
        </View>
      );
    default:
      return null;
  }
}
