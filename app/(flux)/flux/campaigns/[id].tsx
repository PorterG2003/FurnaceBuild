import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { BaseModal, ConfirmDeleteModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/feedback/Toast';
import {
  FluxCampaignManualEditor,
  FluxCampaignQaPanel,
  FluxChatPanel,
  FluxEditorSplitLayout,
} from '@/components/flux';
import { FluxGoogleFontWebLinks } from '@/components/flux/FluxGoogleFontWebLinks';
import { PageRenderer } from '@/components/flux/PageRenderer';
import { callFluxEditorChat } from '@/lib/flux/callFluxEditorChat';
import { callFluxPreviewGenerate } from '@/lib/flux/callFluxGenerate';
import {
  deriveFluxCampaignQaStatus,
  parseFluxCopySlots,
} from '@/lib/flux/fluxCampaignMethodologyQa';
import type { FluxCampaignChatMessage } from '@/lib/flux/fluxCampaignChatState';
import { emptyFluxCampaignChatState } from '@/lib/flux/fluxCampaignChatState';
import { getFluxEditorChatUrl } from '@/lib/flux/fluxEditorChatUrl';
import { getFluxGenerateUrl } from '@/lib/flux/fluxGenerateUrl';
import { FLUX_GOOGLE_FONT_NAMES } from '@/lib/flux/googleFontsCatalog';
import {
  applyLocalPreviewPatches,
  defaultFluxPreviewProspect,
  getFluxAiTierSnapshot,
} from '@/lib/flux/fluxCampaignPreview';
import {
  getFluxCampaignStudioUnlocked,
  setFluxCampaignStudioUnlocked,
} from '@/lib/flux/fluxCampaignStudioPersistence';
import {
  fluxCampaignEditorReducer,
  initialFluxCampaignEditorState,
} from '@/lib/flux/editor/reducer';
import type { Block, FluxProspectRow, PageConfig } from '@/lib/flux/types';
import {
  deleteFluxCampaign,
  ensureFluxTemplateExists,
  getFluxCampaignById,
  getFluxProspects,
  getFluxTemplate,
  updateFluxCampaign,
  updateFluxTemplateChatState,
  upsertFluxTemplate,
} from '@/lib/supabase/services/flux';

export default function CampaignDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [prospects, setProspects] = useState<FluxProspectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [studioUnlocked, setStudioUnlocked] = useState(false);

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

  const copySlotsList = useMemo(() => parseFluxCopySlots(editor.copySlots), [editor.copySlots]);
  const previewProspectSerialized = useMemo(
    () => JSON.stringify(editor.previewProspect),
    [editor.previewProspect],
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [campaign, template, nextProspects, unlocked] = await Promise.all([
        getFluxCampaignById(id),
        getFluxTemplate(id),
        getFluxProspects(id),
        getFluxCampaignStudioUnlocked(id),
      ]);
      if (!campaign) {
        router.back();
        return;
      }
      const templateRow = template ?? (await ensureFluxTemplateExists(id));
      setProspects(nextProspects);
      setStudioUnlocked(unlocked);
      dispatch({
        type: 'hydrate',
        payload: {
          name: campaign.name,
          offerDescription: campaign.offer_description || '',
          blocks: templateRow.blocks,
          contentAssets: templateRow.content_assets,
          copySlots: templateRow.copy_slots.join(', '),
          constraints: templateRow.constraints,
          chatState: templateRow.chat_state ?? emptyFluxCampaignChatState(),
        },
      });
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

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
  }, [
    loading,
    id,
    editor.previewProspect,
    editor.constraints,
    editor.contentAssets,
    editor.blocks,
    copySlotsList,
  ]);

  useEffect(() => {
    if (loading || !id || !previewSeedForLoadRef.current) return;
    const current = getFluxAiTierSnapshot({
      prospect: editor.previewProspect,
      copy_slots: copySlotsList,
      constraints: editor.constraints,
      content_assets: editor.contentAssets,
      blocks: editor.blocks,
    });
    const baseline = lastAiTierRef.current ?? initialAiTierRef.current;
    if (baseline === null) return;
    setNeedsAiRerender(current !== baseline);
  }, [
    loading,
    id,
    editor.previewProspect,
    editor.constraints,
    editor.contentAssets,
    editor.blocks,
    copySlotsList,
    previewProspectSerialized,
  ]);

  useEffect(() => {
    if (loading || !id || previewAiLoading) return;
    setPreviewPageConfig((previous) =>
      applyLocalPreviewPatches(previous, editor.previewProspect, editor.blocks, {
        syncBlocksFromTemplate: !needsAiRerender,
      }),
    );
  }, [loading, id, previewAiLoading, previewProspectSerialized, editor.blocks, needsAiRerender]);

  const previewFresh = studioUnlocked && !needsAiRerender;
  const qaStatus = useMemo(
    () =>
      deriveFluxCampaignQaStatus({
        editor,
        studioUnlocked,
        previewFresh,
      }),
    [editor, previewFresh, studioUnlocked],
  );

  const persistChatState = useCallback(
    async (messages: FluxCampaignChatMessage[], lastSummary: string[] | null) => {
      if (!id) return;
      try {
        await updateFluxTemplateChatState(id, {
          messages,
          lastSummary,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn('[flux] failed to persist chat_state', error);
      }
    },
    [id],
  );

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
      const mergedBlocks = JSON.parse(JSON.stringify(result.pageConfig.blocks)) as Block[];
      const nextPageConfig: PageConfig = { ...result.pageConfig, blocks: mergedBlocks };
      dispatch({ type: 'block.setBlocks', blocks: mergedBlocks });
      setPreviewPageConfig(nextPageConfig);
      const snapshot = getFluxAiTierSnapshot({
        prospect: editor.previewProspect,
        copy_slots: copySlotsList,
        constraints: editor.constraints,
        content_assets: editor.contentAssets,
        blocks: mergedBlocks,
      });
      lastAiTierRef.current = snapshot;
      initialAiTierRef.current = snapshot;
      setNeedsAiRerender(false);
      if (!studioUnlocked) {
        setStudioUnlocked(true);
        await setFluxCampaignStudioUnlocked(id, true);
      }
    } finally {
      setPreviewAiLoading(false);
    }
  }, [
    id,
    previewAiLoading,
    studioUnlocked,
    editor.previewProspect,
    editor.blocks,
    editor.contentAssets,
    editor.constraints,
    copySlotsList,
  ]);

  const handleChatSend = useCallback(
    async (text: string) => {
      if (!id) return;
      const transcript = [
        ...editor.chatMessages.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user' as const, content: text },
      ];
      const userMessage: FluxCampaignChatMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: text,
      };
      dispatch({
        type: 'chat.appendUser',
        id: userMessage.id,
        content: text,
      });
      await persistChatState([...editor.chatMessages, userMessage], editor.chatLastSummary);
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
          const assistantErrorMessage: FluxCampaignChatMessage = {
            id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'assistant',
            content: `Sorry — ${result.message}`,
          };
          dispatch({
            type: 'chat.appendAssistant',
            id: assistantErrorMessage.id,
            content: assistantErrorMessage.content,
          });
          await persistChatState(
            [...editor.chatMessages, userMessage, assistantErrorMessage],
            editor.chatLastSummary,
          );
          return;
        }
        if (result.data.operations.length > 0) {
          dispatch({ type: 'chat.applyRemoteOperations', operations: result.data.operations });
        }
        const assistantMessage: FluxCampaignChatMessage = {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content: result.data.assistantMessage,
          ...(result.data.summary ? { summary: result.data.summary } : {}),
        };
        dispatch({
          type: 'chat.appendAssistant',
          id: assistantMessage.id,
          content: assistantMessage.content,
          summary: result.data.summary,
        });
        await persistChatState(
          [...editor.chatMessages, userMessage, assistantMessage],
          result.data.summary ?? editor.chatLastSummary,
        );
      } finally {
        dispatch({ type: 'chat.setSending', value: false });
      }
    },
    [id, editor, copySlotsList, persistChatState],
  );

  const performSave = useCallback(async () => {
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
        copy_slots: copySlotsList,
        constraints: editor.constraints,
      });
      toast.success('Campaign saved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save campaign.');
    } finally {
      setSaving(false);
    }
  }, [
    id,
    saving,
    editor.name,
    editor.offerDescription,
    editor.blocks,
    editor.contentAssets,
    editor.constraints,
    copySlotsList,
    toast,
  ]);

  const handleSave = useCallback(() => {
    void performSave();
  }, [performSave]);

  const handleDelete = useCallback(() => {
    if (!id || deleting) return;
    setDeleteConfirmOpen(true);
  }, [id, deleting]);

  const confirmDelete = useCallback(async () => {
    if (!id || deleting) return;
    setDeleting(true);
    try {
      await deleteFluxCampaign(id);
      setDeleteConfirmOpen(false);
      toast.success('Campaign deleted.');
      router.replace('/flux' as Href);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete campaign.');
    } finally {
      setDeleting(false);
    }
  }, [id, deleting, router, toast]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#6b7280" />
      </View>
    );
  }

  const fluxGenerateConfigured = Boolean(getFluxGenerateUrl());
  const fluxEditorChatConfigured = Boolean(getFluxEditorChatUrl());
  const isIdeation = !studioUnlocked;
  const showPreviewAiOverlay = studioUnlocked && editor.blocks.length > 0 && (needsAiRerender || previewAiLoading);

  const ideationFooter = (
    <View className="gap-3">
      <Button
        fullWidth
        size="sm"
        onPress={() => {
          void handleRerenderWithAi();
        }}
        disabled={previewAiLoading || !fluxGenerateConfigured || editor.blocks.length === 0}
      >
        {previewAiLoading ? 'Generating preview…' : 'Preview with AI'}
      </Button>
      {!fluxGenerateConfigured ? (
        <Text className="text-amber-200/90 text-xs font-instrument text-center">
          Flux generate URL is not configured. Set `EXPO_PUBLIC_FLUX_GENERATE_URL` and restart Expo.
        </Text>
      ) : null}
      {editor.blocks.length === 0 ? (
        <Text className="text-gray-500 text-xs font-instrument text-center">
          Chat should define at least one block before preview can run.
        </Text>
      ) : null}
    </View>
  );

  const studioFooter = (
    <View className="rounded-xl border border-[#2A2A2A] bg-[#141414] px-3 py-3">
      <Text className="text-gray-300 text-xs font-instrument leading-5 text-center">
        Keep the preview honest after major edits. If Flux pauses because it needs a new block, build
        the primitive and then continue this saved thread.
      </Text>
    </View>
  );

  return (
    <>
      <FluxGoogleFontWebLinks families={FLUX_GOOGLE_FONT_NAMES} />
      <FluxEditorSplitLayout
        variant={isIdeation ? 'ideation' : 'studio'}
        editorLabel={advancedOpen ? 'Manual' : 'Chat'}
        editorScrollable={advancedOpen}
        editorNestableScroll={advancedOpen}
        header={
          <View className="px-3 pt-2 pb-2 border-b border-[#2A2A2A]">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 min-w-0">
                <Pressable onPress={() => router.back()}>
                  <Text className="text-gray-400 text-sm font-instrument">← Back</Text>
                </Pressable>
                <Text className="text-white text-lg font-instrument-semibold mt-2">
                  {editor.name.trim() || 'Untitled Flux campaign'}
                </Text>
              </View>
              <View className="flex-row flex-wrap items-center justify-end gap-1.5">
                {isIdeation ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    className="px-3 py-1.5"
                    onPress={() => {
                      void handleRerenderWithAi();
                    }}
                    disabled={previewAiLoading || !fluxGenerateConfigured || editor.blocks.length === 0}
                  >
                    {previewAiLoading ? 'Generating…' : 'Preview with AI'}
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="secondary"
                  className="px-3 py-1.5"
                  onPress={() => setAdvancedOpen((value) => !value)}
                >
                  {advancedOpen ? 'Back to chat' : 'Manual'}
                </Button>
                {!isIdeation ? (
                  <Pressable
                    onPress={() => setReadinessOpen(true)}
                    className={`h-[30px] flex-row items-center rounded-full border px-3 ${
                      qaStatus.isComplete
                        ? 'border-emerald-500/30 bg-emerald-500/10'
                        : 'border-amber-500/30 bg-amber-500/10'
                    }`}
                  >
                    <Text className="text-white text-xs font-instrument-semibold">
                      Readiness {qaStatus.structuralPassedCount}/{qaStatus.structural.length}
                    </Text>
                    <View
                      className={`mx-2 h-1 w-1 rounded-full ${
                        qaStatus.isComplete ? 'bg-emerald-300' : 'bg-amber-300'
                      }`}
                    />
                    <Text
                      className={`text-[10px] font-instrument-semibold uppercase ${
                        qaStatus.isComplete ? 'text-emerald-200' : 'text-amber-200'
                      }`}
                    >
                      {qaStatus.isComplete ? 'Ready' : 'Open'}
                    </Text>
                  </Pressable>
                ) : null}
                <Button
                  size="xs"
                  variant="destructive"
                  className="px-3 py-1.5"
                  onPress={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
                <Button size="xs" className="px-3 py-1.5" onPress={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </View>
            </View>
          </View>
        }
        editor={
          advancedOpen ? (
            <View className="px-2 pt-2 pb-4">
              <FluxCampaignManualEditor
                editor={editor}
                dispatch={dispatch}
                prospects={prospects}
                onNavigateNewProspect={() =>
                  router.push(`/flux/prospects/new?campaignId=${id}` as Href)
                }
                onNavigateProspect={(prospectId) =>
                  router.push(`/flux/prospects/${prospectId}` as Href)
                }
              />
            </View>
          ) : (
            <View className="flex-1 px-2 pt-1 pb-2" style={{ minHeight: 0 }}>
              <FluxChatPanel
                messages={editor.chatMessages}
                lastSummary={editor.chatLastSummary}
                sending={editor.chatSending}
                error={editor.chatError}
                canUndo={!!editor.chatUndoSnapshot}
                chatConfigured={fluxEditorChatConfigured}
                emptyStateText={
                  isIdeation
                    ? 'Try: “Help me design a reverse lead magnet for dental practice owners. The page should feel custom from just a website URL and deliver one concrete insight in under 60 seconds.”'
                    : 'Try: “Tighten the hero for owner-operators, make the calculator feel more bespoke, and strengthen the proof path without inventing claims.”'
                }
                composerPlaceholder={
                  isIdeation
                    ? 'Describe the campaign you want Flux to design…'
                    : 'Refine the page, proof, or spec…'
                }
                footer={isIdeation ? ideationFooter : studioFooter}
                onSend={handleChatSend}
                onUndo={() => dispatch({ type: 'chat.undoLast' })}
              />
            </View>
          )
        }
        preview={
          <View className="px-4 pt-4 pb-8">
            {previewPageConfig ? (
              <PageRenderer
                config={previewPageConfig}
                assets={editor.contentAssets}
                scrollable={false}
                highlightedBlockId={editor.editingBlockId}
              />
            ) : (
              <View className="py-12 px-6 items-center justify-center min-h-[220px] rounded-2xl border border-[#2A2A2A] bg-[#111]">
                <Text className="text-gray-300 text-sm font-instrument-semibold text-center">
                  Run one AI preview to pressure-test the campaign.
                </Text>
                <Text className="text-gray-500 text-sm font-instrument text-center mt-2 leading-6">
                  The preview becomes the proof surface once Flux has enough structure to personalize.
                </Text>
              </View>
            )}
          </View>
        }
        previewOverlay={
          showPreviewAiOverlay ? (
            <View className="items-center max-w-xs">
              {previewAiLoading ? <ActivityIndicator size="large" color="#e5e7eb" /> : null}
              <Text className="text-white text-center text-sm font-instrument-semibold mt-3 mb-1">
                Rerender with AI
              </Text>
              <Text className="text-gray-300 text-center text-xs font-instrument leading-5 mb-4">
                The template or sample lead changed. Refresh the AI preview before you trust the page again.
              </Text>
              {!fluxGenerateConfigured ? (
                <Text className="text-amber-200/90 text-xs font-instrument text-center mb-3">
                  Flux generate URL is not configured. Set amplify_outputs / EXPO_PUBLIC_FLUX_GENERATE_URL and restart Expo.
                </Text>
              ) : null}
              {previewError && !previewAiLoading ? (
                <Text className="text-red-300 text-xs font-instrument text-center mb-3">
                  {previewError}
                </Text>
              ) : null}
              <Button
                size="sm"
                onPress={() => {
                  void handleRerenderWithAi();
                }}
                disabled={previewAiLoading || !fluxGenerateConfigured}
              >
                {previewAiLoading ? 'Generating…' : 'Rerender with AI'}
              </Button>
            </View>
          ) : undefined
        }
      />

      <BaseModal
        visible={readinessOpen}
        onClose={() => setReadinessOpen(false)}
        title="Campaign readiness"
        description="Flux derives readiness from the written spec, personalization surface, proof path, sample lead, and current AI preview."
        maxWidth="xl"
        maxHeight={720}
      >
        <FluxCampaignQaPanel
          status={qaStatus}
          onOpenAdvanced={() => {
            setReadinessOpen(false);
            setAdvancedOpen(true);
          }}
        />
      </BaseModal>

      <ConfirmDeleteModal
        visible={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete campaign?"
        itemName={editor.name.trim() || 'Untitled Flux campaign'}
        description="This will delete the campaign and its related prospects and pages."
        isLoading={deleting}
        requireConfirmation={false}
        onConfirm={confirmDelete}
      />
    </>
  );
}
