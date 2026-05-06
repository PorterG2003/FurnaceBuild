import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/feedback/Toast';
import { PageRenderer } from '@/components/flux/PageRenderer';
import {
  FluxEditorSplitLayout,
  FluxChatPanel,
  FluxProspectPageManualEditor,
} from '@/components/flux';
import { FLUX_MANUAL_BLOCK_TYPE_LABELS } from '@/components/flux/FluxManualBlockEditor';
import {
  FluxProspectDetailsFields,
  fluxProspectFieldValuesToBrandProfile,
  fluxProspectRowToFieldValues,
  type FluxProspectApplyToPageField,
  type FluxProspectDetailsFieldValues,
} from '@/components/flux/FluxProspectDetailsFields';
import {
  getFluxProspectById,
  getFluxPagesByProspect,
  getFluxCampaignById,
  ensureFluxTemplateExists,
  updateFluxPageStatus,
  updateFluxPageConfig,
  getFluxProspectPageEditorChat,
  updateFluxProspectPageEditorChat,
  updateFluxProspect,
  checkSlugAvailable,
  updateFluxPageSlug,
  getFluxAsyncJob,
} from '@/lib/supabase/services/flux';
import type {
  FluxProspectRow,
  FluxProspectPageRow,
  FluxCampaignRow,
  FluxCampaignTemplateRow,
  FluxPageStatus,
  PageConfig,
} from '@/lib/flux/types';
import {
  coercePageConfig,
  hasRenderableFluxPageConfig,
  canPublishFluxProspectPage,
} from '@/lib/flux/coercePageConfig';
import { getFluxGenerateUrl } from '@/lib/flux/fluxGenerateUrl';
import { getFluxEditorChatUrl } from '@/lib/flux/fluxEditorChatUrl';
import { callFluxGenerate } from '@/lib/flux/callFluxGenerate';
import { callFluxEditorChat } from '@/lib/flux/callFluxEditorChat';
import { callFluxCompetitorAuditStart } from '@/lib/flux/callFluxCompetitorAuditStart';
import { getFluxCompetitorAuditStartUrl } from '@/lib/flux/fluxCompetitorAuditStartUrl';
import { isValidFluxServiceArea } from '@/lib/flux/fluxServiceArea';
import { getMergedFluxPageConfigSemanticIssues } from '@/lib/flux/validateMergedFluxPageConfig';
import {
  applyProspectChatOperations,
  filterProspectChatOperations,
} from '@/lib/flux/prospectPageChatAdapter';
import {
  emptyFluxProspectPageChatState,
  type FluxProspectPageChatCheckpoint,
  type FluxProspectPageChatState,
} from '@/lib/flux/fluxProspectPageChatState';
import type { FluxCampaignChatMessage } from '@/lib/flux/fluxCampaignChatState';
import { getLastFluxChatSummary } from '@/lib/flux/fluxCampaignChatState';
import { sellerProfileFromCampaignRow } from '@/lib/flux/campaignSeller';
import { syncFluxPageConfigLogo } from '@/lib/flux/syncFluxPageConfigLogo';
import { mergeServerCompetitorAuditBlocksIntoDraft } from '@/lib/flux/mergeServerCompetitorAuditBlocks';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  live: 'bg-green-500/20 text-green-300 border-green-500/30',
  archived: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const STATUSES: FluxPageStatus[] = ['draft', 'live', 'archived'];

type ProspectEditorTab = 'manual' | 'chat';

type ParsedPageSaveIssue = {
  blockId: string | null;
  blockType: string | null;
  blockLabel: string;
  fieldLabel: string;
  detail: string;
  isCopyLimit: boolean;
};

const PROSPECT_EDITOR_TABS = [
  { id: 'manual' as const, label: 'Manual' },
  { id: 'chat' as const, label: 'Chat' },
];

function clonePageConfig(config: PageConfig): PageConfig {
  return JSON.parse(JSON.stringify(config)) as PageConfig;
}

function formatIssueFieldLabel(raw: string): string {
  const match = /^props\.items\[(\d+)\]\.(title|description)$/.exec(raw);
  if (match) {
    const index = Number(match[1]) + 1;
    return `Benefit ${index} ${match[2] === 'title' ? 'title' : 'description'}`;
  }
  const dayMatch = /^props\.weeks\[(\d+)\]\.days\[(\d+)\]\.(platform|post_type|hook|cta)$/.exec(raw);
  if (dayMatch) {
    const week = Number(dayMatch[1]) + 1;
    const day = Number(dayMatch[2]) + 1;
    const tail = dayMatch[3] === 'post_type' ? 'post type' : dayMatch[3];
    return `Week ${week}, day ${day} ${tail}`;
  }
  const weekThemeMatch = /^props\.weeks\[(\d+)\]\.theme$/.exec(raw);
  if (weekThemeMatch) return `Week ${Number(weekThemeMatch[1]) + 1} theme`;
  const ctaLadderMatch = /^props\.cta_ladder\[(\d+)\]$/.exec(raw);
  if (ctaLadderMatch) return `CTA ladder step ${Number(ctaLadderMatch[1]) + 1}`;
  if (raw === 'props.headline') return 'Headline';
  if (raw === 'props.subheadline') return 'Subheadline';
  if (raw === 'props.ctaText') return 'CTA text';
  if (raw === 'props.ctaUrl') return 'CTA URL';
  if (raw === 'props.heroImageUrl') return 'Hero image URL';
  if (raw === 'props.heading') return 'Heading';
  if (raw === 'props.inferred_vertical') return 'Inferred vertical';
  if (raw === 'props.inferred_vertical_rationale') return 'Vertical rationale';
  if (raw === 'props.positioning_summary') return 'Positioning summary';
  if (raw === 'props.platform_mix_note') return 'Platform mix note';
  return raw.replace(/^props\./, '').replaceAll('_', ' ');
}

function parsePageSaveIssue(issue: string): ParsedPageSaveIssue {
  const prefixMatch = /^Block ([^ ]+) \(([^)]+)\): (.+)$/.exec(issue);
  if (!prefixMatch) {
    return {
      blockId: null,
      blockType: null,
      blockLabel: 'Page issue',
      fieldLabel: 'Validation',
      detail: issue,
      isCopyLimit: false,
    };
  }

  const [, blockId, blockType, remainder] = prefixMatch;
  const blockLabel =
    FLUX_MANUAL_BLOCK_TYPE_LABELS[blockType as keyof typeof FLUX_MANUAL_BLOCK_TYPE_LABELS] ?? blockType;
  const lengthMatch = /^([^ ]+) length (\d+) exceeds hard max (\d+) \(target (\d+), tier ([^)]+)\)$/.exec(
    remainder,
  );
  if (lengthMatch) {
    const [, fieldPath, current, hardMax, target, tier] = lengthMatch;
    return {
      blockId,
      blockType,
      blockLabel,
      fieldLabel: formatIssueFieldLabel(fieldPath),
      detail: `${current}/${hardMax} chars (target ${target}, ${tier} layout)`,
      isCopyLimit: true,
    };
  }

  const genericFieldMatch = /^([^ ]+) (.+)$/.exec(remainder);
  if (genericFieldMatch) {
    const [, fieldPath, detail] = genericFieldMatch;
    return {
      blockId,
      blockType,
      blockLabel,
      fieldLabel: formatIssueFieldLabel(fieldPath),
      detail,
      isCopyLimit: false,
    };
  }

  return {
    blockId,
    blockType,
    blockLabel,
    fieldLabel: 'Validation',
    detail: remainder,
    isCopyLimit: false,
  };
}

export default function ProspectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [prospect, setProspect] = useState<FluxProspectRow | null>(null);
  const [page, setPage] = useState<FluxProspectPageRow | null>(null);
  const [campaign, setCampaign] = useState<FluxCampaignRow | null>(null);
  const [template, setTemplate] = useState<FluxCampaignTemplateRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [prospectDraft, setProspectDraft] = useState<FluxProspectDetailsFieldValues | null>(null);
  const [savingProspect, setSavingProspect] = useState(false);

  const [editorTab, setEditorTab] = useState<ProspectEditorTab>('manual');
  const [draftPageConfig, setDraftPageConfig] = useState<PageConfig | null>(null);
  const [savingPage, setSavingPage] = useState(false);
  const [prospectChat, setProspectChat] = useState<FluxProspectPageChatState>(emptyFluxProspectPageChatState());
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [draftSlug, setDraftSlug] = useState('');
  const [slugCheckAvailable, setSlugCheckAvailable] = useState<boolean | null>(null);
  const [slugChecking, setSlugChecking] = useState(false);
  const [savingSlug, setSavingSlug] = useState(false);
  const [auditPollJobId, setAuditPollJobId] = useState<string | null>(null);
  const [auditBusyBlockId, setAuditBusyBlockId] = useState<string | null>(null);
  const [requestedEditingBlockId, setRequestedEditingBlockId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const p = await getFluxProspectById(id);
      if (!p) {
        router.back();
        return;
      }
      setProspect(p);
      setProspectDraft(fluxProspectRowToFieldValues(p));

      const [pages, c] = await Promise.all([
        getFluxPagesByProspect(id),
        getFluxCampaignById(p.campaign_id),
      ]);
      if (pages.length > 0) setPage(pages[0]);
      else setPage(null);
      if (c) {
        setCampaign(c);
        setTemplate(await ensureFluxTemplateExists(c.id));
      } else {
        setCampaign(null);
        setTemplate(null);
      }
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auditPollJobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const row = await getFluxAsyncJob(auditPollJobId);
        if (cancelled || !row) return;
        if (row.status === 'succeeded' || row.status === 'failed' || row.status === 'cancelled') {
          setAuditPollJobId(null);
          await load();
        }
      } catch {
        /* transient */
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [auditPollJobId, load]);

  useEffect(() => {
    if (page?.slug != null) {
      setDraftSlug(page.slug);
      setSlugCheckAvailable(null);
    }
  }, [page?.id, page?.slug]);

  const saveProspectChatToDb = useCallback(async (next: FluxProspectPageChatState) => {
    if (!page) return false;
    try {
      await updateFluxProspectPageEditorChat(page.account_id, page.id, next);
      return true;
    } catch (e) {
      console.warn('[flux] prospect chat persist failed', e);
      return false;
    }
  }, [page]);

  const handleStatusChange = async (status: FluxPageStatus) => {
    if (!page || statusUpdating) return;
    if (status === 'live' && !hasRenderableFluxPageConfig(page.page_config)) {
      Alert.alert(
        'Generate first',
        'Run Generate or Regenerate so this page has blocks and copy. Only then can it go live—the public URL reads the saved page config.',
      );
      return;
    }
    if (status === 'live' && !canPublishFluxProspectPage(page.page_config)) {
      Alert.alert(
        'Competitor audit incomplete',
        'This page includes a competitor ad audit block that is not finished yet. Run the audit from the prospect editor and wait until it shows Ready, then save the page before going live.',
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

  const slugDirty = useMemo(() => {
    if (!page) return false;
    return draftSlug.trim() !== page.slug;
  }, [page, draftSlug]);

  const checkDraftSlug = useCallback(async () => {
    if (!page) return;
    const s = draftSlug.trim();
    if (!s) {
      setSlugCheckAvailable(false);
      return;
    }
    if (s === page.slug) {
      setSlugCheckAvailable(null);
      return;
    }
    setSlugChecking(true);
    try {
      const ok = await checkSlugAvailable(s, page.id);
      setSlugCheckAvailable(ok);
    } finally {
      setSlugChecking(false);
    }
  }, [page, draftSlug]);

  const handleSaveSlug = useCallback(async () => {
    if (!page || savingSlug) return;
    const next = draftSlug.trim();
    if (!next) {
      toast.error('Slug cannot be empty.');
      return;
    }
    if (next === page.slug) {
      toast.success('Slug unchanged.');
      return;
    }
    const ok = await checkSlugAvailable(next, page.id);
    if (!ok) {
      setSlugCheckAvailable(false);
      toast.error('That slug is already taken.');
      return;
    }
    const prev = page.slug;
    setSavingSlug(true);
    try {
      const updated = await updateFluxPageSlug(page.id, next);
      setPage(updated);
      setDraftSlug(updated.slug);
      setSlugCheckAvailable(null);
      toast.success('Slug updated.');
      if (prev !== updated.slug) {
        Alert.alert(
          'Public URL changed',
          `Old path /p/${prev} will no longer work. Share /p/${updated.slug} instead.`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update slug.');
    } finally {
      setSavingSlug(false);
    }
  }, [page, draftSlug, savingSlug, toast]);

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

  const savedPageConfig = useMemo(
    () => (page ? coercePageConfig(page.page_config) : null),
    [page?.id, page?.updated_at, page?.page_config],
  );

  const pageDirty = useMemo(() => {
    if (!draftPageConfig || !savedPageConfig) return false;
    return JSON.stringify(draftPageConfig) !== JSON.stringify(savedPageConfig);
  }, [draftPageConfig, savedPageConfig]);

  const pageSaveIssues = useMemo(
    () =>
      draftPageConfig
        ? getMergedFluxPageConfigSemanticIssues(draftPageConfig, template?.content_assets ?? [])
        : [],
    [draftPageConfig, template?.content_assets],
  );

  const parsedPageSaveIssues = useMemo(
    () => pageSaveIssues.map(parsePageSaveIssue),
    [pageSaveIssues],
  );

  const pageIssueCountByBlockId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const issue of parsedPageSaveIssues) {
      if (!issue.blockId) continue;
      counts[issue.blockId] = (counts[issue.blockId] ?? 0) + 1;
    }
    return counts;
  }, [parsedPageSaveIssues]);

  const hasCopyBudgetIssues = useMemo(
    () => parsedPageSaveIssues.some((issue) => issue.isCopyLimit),
    [parsedPageSaveIssues],
  );

  useEffect(() => {
    if (!requestedEditingBlockId) return;
    if (!pageIssueCountByBlockId[requestedEditingBlockId]) {
      setRequestedEditingBlockId(null);
    }
  }, [pageIssueCountByBlockId, requestedEditingBlockId]);

  /**
   * Keep `draftPageConfig` aligned with `page.page_config` whenever the server row changes.
   * Depends on `page?.page_config` (not only `updated_at`) so async worker updates (audit status)
   * refresh the editor. If the user has local non-audit edits, merging audit blocks from the server
   * yields a config that still differs from `serverCfg`; in that case we keep the merged draft.
   */
  useEffect(() => {
    if (!page) {
      setDraftPageConfig(null);
      setProspectChat(emptyFluxProspectPageChatState());
      return;
    }
    const serverCfg = coercePageConfig(page.page_config);
    if (!serverCfg) {
      setDraftPageConfig(null);
      return;
    }
    let cancelled = false;
    void getFluxProspectPageEditorChat(page.id).then((s) => {
      if (!cancelled) setProspectChat(s);
    });
    setDraftPageConfig((prev) => {
      if (!prev) return serverCfg;
      if (JSON.stringify(prev) === JSON.stringify(serverCfg)) return prev;
      const merged = mergeServerCompetitorAuditBlocksIntoDraft(prev, serverCfg);
      if (JSON.stringify(merged) === JSON.stringify(serverCfg)) return serverCfg;
      return merged;
    });
    return () => {
      cancelled = true;
    };
  }, [page?.id, page?.updated_at, page?.page_config]);

  const prospectRowDirty = useMemo(() => {
    if (!prospect || !prospectDraft) return false;
    return (
      JSON.stringify(prospectDraft) !== JSON.stringify(fluxProspectRowToFieldValues(prospect))
    );
  }, [prospect, prospectDraft]);

  /** Shown when Run audit is disabled so the control does not feel “dead” (heading copy ≠ saved service area). */
  const competitorAuditRunBlockers = useMemo(() => {
    const lines: string[] = [];
    if (auditPollJobId) {
      lines.push('An audit job is already in progress; this page refreshes when it finishes.');
    }
    if (prospectRowDirty) {
      lines.push('Save prospect changes before running the audit.');
    }
    if (pageDirty) {
      lines.push('Save page changes before running the audit.');
    }
    if (prospect && !isValidFluxServiceArea(prospect.service_area)) {
      lines.push(
        'Set a Google Places service area on the prospect below and save. Block headings are only display text.',
      );
    }
    return lines;
  }, [auditPollJobId, pageDirty, prospect, prospectRowDirty]);

  const patchProspectDraft = useCallback((patch: Partial<FluxProspectDetailsFieldValues>) => {
    setProspectDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const applyProspectFieldToPage = useCallback(
    (field: FluxProspectApplyToPageField) => {
      if (!prospectDraft) return;
      setDraftPageConfig((c) => {
        if (!c) return c;
        const t = c.theme;
        switch (field) {
          case 'name':
            return { ...c, prospectName: prospectDraft.name };
          case 'company':
            return { ...c, companyName: prospectDraft.company };
          case 'brand_primaryColor':
            return { ...c, theme: { ...t, primaryColor: prospectDraft.brand_primaryColor } };
          case 'brand_accentColor': {
            const accent = prospectDraft.brand_accentColor.trim()
              ? prospectDraft.brand_accentColor
              : prospectDraft.brand_primaryColor;
            return { ...c, theme: { ...t, accentColor: accent } };
          }
          case 'brand_fontFamily':
            return { ...c, theme: { ...t, fontFamily: prospectDraft.brand_fontFamily.trim() || t.fontFamily } };
          case 'brand_blockStylePreset':
            return { ...c, theme: { ...t, blockStylePreset: prospectDraft.brand_blockStylePreset } };
          case 'brand_logoUrl': {
            const logo = prospectDraft.brand_logoUrl.trim();
            return {
              ...c,
              theme: { ...t, ...(logo ? { logoUrl: logo } : { logoUrl: undefined }) },
            };
          }
          default:
            return c;
        }
      });
    },
    [prospectDraft],
  );

  const handleDiscardProspectRow = useCallback(() => {
    if (!prospect) return;
    setProspectDraft(fluxProspectRowToFieldValues(prospect));
  }, [prospect]);

  const handleSaveProspectRow = useCallback(async () => {
    if (!prospect || !prospectDraft || savingProspect) return;
    setSavingProspect(true);
    try {
      const updated = await updateFluxProspect(prospect.id, {
        name: prospectDraft.name.trim(),
        company: prospectDraft.company.trim(),
        role: prospectDraft.role.trim() || null,
        url: prospectDraft.url.trim() || null,
        industry: prospectDraft.industry.trim() || null,
        company_size: prospectDraft.company_size.trim() || null,
        email_notes: prospectDraft.email_notes.trim() || null,
        brand_profile: fluxProspectFieldValuesToBrandProfile(prospectDraft),
        service_area: prospectDraft.service_area,
      });
      setProspect(updated);
      if (page && campaign) {
        const savedPageConfig = coercePageConfig(page.page_config);
        if (savedPageConfig) {
          const syncedPageConfig = syncFluxPageConfigLogo(savedPageConfig, {
            prospectBrand: updated.brand_profile,
            prospectWebsiteIntel: updated.website_intel_snapshot,
            sellerBrand: campaign.seller_brand_profile,
            sellerWebsiteIntel: campaign.seller_website_intel_snapshot,
            brandingPolicy: campaign.branding_policy,
          });
          const currentLogoUrl = savedPageConfig.theme.logoUrl?.trim() || undefined;
          const nextLogoUrl = syncedPageConfig.theme.logoUrl?.trim() || undefined;
          if (currentLogoUrl !== nextLogoUrl) {
            const syncedPage = await updateFluxPageConfig(page.id, syncedPageConfig);
            setPage(syncedPage);
          }
        }
      }
      setProspectDraft(fluxProspectRowToFieldValues(updated));
      toast.success('Prospect saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save prospect.');
    } finally {
      setSavingProspect(false);
    }
  }, [campaign, page, prospect, prospectDraft, savingProspect, toast]);

  const handleSavePage = useCallback(async () => {
    if (!page || !draftPageConfig || !prospect || !campaign || savingPage) return;
    const issues = pageSaveIssues;
    if (issues.length > 0) {
      toast.error(
        issues.length === 1
          ? 'Fix 1 page issue before saving.'
          : `Fix ${issues.length} page issues before saving.`,
      );
      console.warn('[flux] page save blocked by validation', issues);
      Alert.alert('Fix before saving', issues.join('\n'));
      return;
    }
    setSavingPage(true);
    try {
      const syncedPageConfig = syncFluxPageConfigLogo(draftPageConfig, {
        prospectBrand: prospect.brand_profile,
        prospectWebsiteIntel: prospect.website_intel_snapshot,
        sellerBrand: campaign.seller_brand_profile,
        sellerWebsiteIntel: campaign.seller_website_intel_snapshot,
        brandingPolicy: campaign.branding_policy,
      });
      const updated = await updateFluxPageConfig(page.id, syncedPageConfig);
      setPage(updated);
      toast.success('Page saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save page.');
    } finally {
      setSavingPage(false);
    }
  }, [campaign, draftPageConfig, page, pageSaveIssues, prospect, savingPage, toast]);

  const handleOpenIssue = useCallback((blockId: string | null) => {
    setEditorTab('manual');
    if (!blockId) return;
    setRequestedEditingBlockId(blockId);
  }, []);

  const handleToggleAllowLongCopy = useCallback((enabled: boolean) => {
    setDraftPageConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        theme: {
          ...current.theme,
          ...(enabled ? { allowLongCopy: true } : { allowLongCopy: undefined }),
        },
      };
    });
  }, []);

  const handleDiscardPage = useCallback(() => {
    if (!page) return;
    const c = coercePageConfig(page.page_config);
    setDraftPageConfig(c);
  }, [page]);

  const handleChatSend = useCallback(
    async (text: string) => {
      if (!prospect || !page || !draftPageConfig || !campaign) return;
      const userMessage: FluxCampaignChatMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'user',
        content: text,
      };
      const checkpoint: FluxProspectPageChatCheckpoint = {
        pageConfig: clonePageConfig(draftPageConfig),
        editingBlockId: null,
      };
      const nextCheckpoints = { ...prospectChat.checkpoints, [userMessage.id]: checkpoint };
      const messagesAfterUser = [...prospectChat.messages, userMessage];
      const afterUser: FluxProspectPageChatState = {
        ...prospectChat,
        messages: messagesAfterUser,
        checkpoints: nextCheckpoints,
        updatedAt: new Date().toISOString(),
      };
      setProspectChat(afterUser);
      await saveProspectChatToDb(afterUser);

      const transcript = [
        ...prospectChat.messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: text },
      ];

      setChatSending(true);
      setChatError(null);
      try {
        const result = await callFluxEditorChat({
          campaignId: prospect.campaign_id,
          prospectPageId: page.id,
          messages: transcript,
          editor: {
            mode: 'prospect_page',
            page_config: draftPageConfig,
            content_assets: template?.content_assets ?? [],
            prospect_record: { name: prospect.name, company: prospect.company },
            seller_profile: sellerProfileFromCampaignRow(campaign),
            branding_policy: campaign.branding_policy,
          },
        });
        if (!result.ok) {
          setChatError(result.message);
          const assistantErrorMessage: FluxCampaignChatMessage = {
            id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'assistant',
            content: `Sorry — ${result.message}`,
          };
          const errChat: FluxProspectPageChatState = {
            ...afterUser,
            messages: [...afterUser.messages, assistantErrorMessage],
            updatedAt: new Date().toISOString(),
          };
          setProspectChat(errChat);
          await saveProspectChatToDb(errChat);
          return;
        }
        const safeOps = filterProspectChatOperations(result.data.operations);
        if (safeOps.length > 0) {
          setDraftPageConfig((prev) =>
            prev
              ? applyProspectChatOperations(prev, template?.content_assets ?? [], safeOps)
              : prev,
          );
        }
        const assistantMessage: FluxCampaignChatMessage = {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          content: result.data.assistantMessage,
          ...(result.data.summary ? { summary: result.data.summary } : {}),
        };
        const done: FluxProspectPageChatState = {
          ...afterUser,
          messages: [...afterUser.messages, assistantMessage],
          lastSummary: result.data.summary ?? afterUser.lastSummary,
          updatedAt: new Date().toISOString(),
        };
        setProspectChat(done);
        await saveProspectChatToDb(done);
      } finally {
        setChatSending(false);
      }
    },
    [
      prospect,
      page,
      draftPageConfig,
      campaign,
      template?.content_assets,
      prospectChat,
      saveProspectChatToDb,
    ],
  );

  const handleChatRewind = useCallback(
    async (message: FluxCampaignChatMessage) => {
      if (chatSending || message.role !== 'user') return false;
      const index = prospectChat.messages.findIndex((entry) => entry.id === message.id);
      const checkpoint = prospectChat.checkpoints[message.id];
      if (index < 0 || !checkpoint) return false;

      const nextMessages = prospectChat.messages.slice(0, index);
      const nextCheckpoints: Record<string, FluxProspectPageChatCheckpoint> = {};
      for (const entry of nextMessages) {
        if (entry.role !== 'user') continue;
        const existing = prospectChat.checkpoints[entry.id];
        if (existing) nextCheckpoints[entry.id] = existing;
      }
      const nextLastSummary = getLastFluxChatSummary(nextMessages);
      setDraftPageConfig(clonePageConfig(checkpoint.pageConfig));
      const nextChat: FluxProspectPageChatState = {
        messages: nextMessages,
        checkpoints: nextCheckpoints,
        lastSummary: nextLastSummary,
        updatedAt: new Date().toISOString(),
      };
      setProspectChat(nextChat);
      const persisted = await saveProspectChatToDb(nextChat);
      if (!persisted) {
        toast.warning('Rewound locally, but failed to save the chat branch.');
      }
      return true;
    },
    [chatSending, prospectChat, saveProspectChatToDb, toast],
  );

  const handleStartCompetitorAudit = useCallback(
    async (blockId: string) => {
      if (!page) return;
      if (auditBusyBlockId) {
        toast.info('Wait for the audit request that is already starting.');
        return;
      }
      if (auditPollJobId) {
        toast.info('An audit is already running; this screen will update when it completes.');
        return;
      }
      if (pageDirty) {
        toast.error('Save page changes before running the audit.');
        return;
      }
      if (prospectRowDirty) {
        toast.error('Save prospect (including service area) before running the audit.');
        return;
      }
      if (!prospect || !isValidFluxServiceArea(prospect.service_area)) {
        toast.error('Set and save a service area on the prospect first.');
        return;
      }
      setAuditBusyBlockId(blockId);
      try {
        const r = await callFluxCompetitorAuditStart({ pageId: page.id, blockId });
        if (!r.ok) {
          toast.error(r.message);
          return;
        }
        setAuditPollJobId(r.jobId);
        toast.success('Audit started. This screen refreshes when the job finishes.');
      } finally {
        setAuditBusyBlockId(null);
      }
    },
    [auditBusyBlockId, auditPollJobId, page, pageDirty, prospect, prospectRowDirty, toast],
  );

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#6b7280" />
      </View>
    );
  }

  if (!prospect) return null;

  const previewLiveConfig = draftPageConfig ?? savedPageConfig;
  const hasPageConfig = previewLiveConfig != null;
  const fluxGenerateConfigured = Boolean(getFluxGenerateUrl());
  const fluxEditorChatConfigured = Boolean(getFluxEditorChatUrl());

  return (
    <FluxEditorSplitLayout
      editorNestableScroll={editorTab === 'manual' && draftPageConfig != null}
      editorLabel="Edit"
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

          <View className="flex-row items-start justify-between mb-4">
            <View className="flex-1 mr-4">
              <Text className="text-white text-xl font-instrument-semibold">{prospect.name}</Text>
              <Text className="text-gray-400 text-sm font-instrument">
                {prospect.company}
                {prospect.role ? ` · ${prospect.role}` : ''}
              </Text>
              {campaign && (
                <Text className="text-gray-500 text-xs font-instrument mt-1">Campaign: {campaign.name}</Text>
              )}
            </View>
          </View>

          {page?.status === 'live' && !hasRenderableFluxPageConfig(page.page_config) && (
            <View className="border border-amber-500/40 bg-amber-500/10 rounded-xl p-4 mb-4">
              <Text className="text-amber-100 text-sm font-instrument leading-5">
                Status is <Text className="font-instrument-semibold">live</Text> but there is no generated page yet
                (empty config). The public URL will not show content until you run Generate or Regenerate, or you can
                switch back to draft.
              </Text>
            </View>
          )}

          {page?.status === 'live' &&
            hasRenderableFluxPageConfig(page.page_config) &&
            !canPublishFluxProspectPage(page.page_config) && (
              <View className="border border-amber-500/40 bg-amber-500/10 rounded-xl p-4 mb-4">
                <Text className="text-amber-100 text-sm font-instrument leading-5">
                  Status is <Text className="font-instrument-semibold">live</Text> but a competitor ad audit block is not
                  complete. Finish the audit (or switch to draft) so the public page matches your quality bar.
                </Text>
              </View>
            )}

          {page && (
            <View className="border border-[#2A2A2A] rounded-xl p-4 bg-[#1A1A1A] mb-4">
              <View className="mb-3">
                <Text className="text-gray-400 text-xs font-instrument mb-1">Slug</Text>
                <View className="flex-row items-center gap-2 flex-wrap">
                  <Text className="text-gray-400 text-sm font-instrument">/p/</Text>
                  <TextInput
                    className="flex-1 min-w-[120px] text-white text-sm font-instrument-semibold bg-[#222] border border-[#333] rounded-lg px-3 py-2"
                    value={draftSlug}
                    onChangeText={(t) => {
                      setDraftSlug(t);
                      setSlugCheckAvailable(null);
                    }}
                    onBlur={() => void checkDraftSlug()}
                    placeholder="your-page-slug"
                    placeholderTextColor="#555"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {slugChecking ? (
                    <ActivityIndicator size="small" color="#6b7280" />
                  ) : slugCheckAvailable === true ? (
                    <Text className="text-green-400 text-xs font-instrument">Available</Text>
                  ) : slugCheckAvailable === false ? (
                    <Text className="text-red-400 text-xs font-instrument">Taken</Text>
                  ) : null}
                </View>
                <View className="flex-row flex-wrap gap-2 mt-2 items-center">
                  <Button
                    size="sm"
                    onPress={handleSaveSlug}
                    disabled={savingSlug || !slugDirty || slugCheckAvailable === false}
                  >
                    {savingSlug ? 'Saving…' : 'Save slug'}
                  </Button>
                  <Button size="sm" variant="secondary" onPress={handleCopyUrl}>
                    Copy URL
                  </Button>
                </View>
              </View>

              <View className="flex-row items-center gap-2 mb-3">
                <Text className="text-gray-400 text-xs font-instrument mr-2">Status:</Text>
                {STATUSES.map((s) => (
                  <Pressable
                    key={s}
                    className={`px-3 py-1 rounded-lg border ${
                      page.status === s ? STATUS_COLORS[s] : 'border-[#3A3A3A] bg-[#2A2A2A]'
                    }`}
                    onPress={() => handleStatusChange(s)}
                    disabled={
                      statusUpdating ||
                      (s === 'live' && !canPublishFluxProspectPage(page.page_config))
                    }
                  >
                    <Text
                      className={`text-xs font-instrument-semibold ${page.status === s ? '' : 'text-gray-400'}`}
                    >
                      {s}
                    </Text>
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

          {hasPageConfig && page && draftPageConfig && draftPageConfig.blocks.some((b) => b.type === 'competitor_ad_audit') && (
            <View className="border border-indigo-500/25 bg-indigo-500/5 rounded-xl p-4 mb-4">
              <Text className="text-white text-sm font-instrument-semibold mb-1">Competitor ad audit</Text>
              <Text className="text-gray-400 text-xs font-instrument mb-3 leading-5">
                Uses the prospect service area (saved on the prospect row). Save prospect and page before starting.
                Polling refreshes this page when the job completes.
              </Text>
              {!getFluxCompetitorAuditStartUrl() ? (
                <Text className="text-amber-200/90 text-xs font-instrument mb-2">
                  Deploy Amplify so amplify_outputs.json includes custom.fluxCompetitorAuditStartUrl (or set
                  EXPO_PUBLIC_FLUX_COMPETITOR_AUDIT_START_URL).
                </Text>
              ) : null}
              {competitorAuditRunBlockers.length > 0 ? (
                <View className="mb-3 gap-1.5">
                  {competitorAuditRunBlockers.map((line) => (
                    <Text key={line} className="text-amber-200/95 text-xs font-instrument leading-5">
                      — {line}
                    </Text>
                  ))}
                </View>
              ) : null}
              <View className="gap-2">
                {draftPageConfig.blocks
                  .filter((b) => b.type === 'competitor_ad_audit')
                  .map((b) => (
                    <View key={b.id} className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-gray-300 text-xs font-instrument flex-1 min-w-[140px]">
                        {b.props.heading?.trim() || 'Audit block'} · {b.props.status}
                      </Text>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          auditBusyBlockId === b.id ||
                          Boolean(auditPollJobId) ||
                          prospectRowDirty ||
                          pageDirty ||
                          !isValidFluxServiceArea(prospect.service_area) ||
                          b.props.status === 'running'
                        }
                        accessibilityHint={
                          competitorAuditRunBlockers.length > 0
                            ? competitorAuditRunBlockers.join(' ')
                            : b.props.status === 'running'
                              ? 'Audit is running'
                              : 'Starts the competitor ad audit job'
                        }
                        onPress={() => void handleStartCompetitorAudit(b.id)}
                      >
                        {auditBusyBlockId === b.id
                          ? 'Starting…'
                          : b.props.status === 'running'
                            ? 'Running…'
                            : 'Run audit'}
                      </Button>
                    </View>
                  ))}
              </View>
            </View>
          )}

          {!hasPageConfig && page && (
            <View className="border border-[#2A2A2A] rounded-xl p-6 items-center mb-4">
              <Text className="text-gray-400 text-sm font-instrument mb-3">Page not yet generated.</Text>
              <Button size="sm" onPress={handleRegenerate} disabled={regenerating}>
                {regenerating ? 'Generating...' : 'Generate Now'}
              </Button>
            </View>
          )}

          {!hasPageConfig && page && prospect && prospectDraft && campaign && (
            <View className="border border-[#2A2A2A] rounded-xl p-4 bg-[#1A1A1A] gap-2 mb-4">
              <FluxProspectDetailsFields
                partition="full"
                variant="embedded"
                showBrandProfile
                values={prospectDraft}
                onChange={patchProspectDraft}
                inputClassName="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
                labelClassName="text-gray-400 text-xs font-instrument mb-1"
              />
              {prospect.website_intel_snapshot ? (
                <View className="mt-2 border border-[#2A2A2A] rounded-xl p-3 gap-1">
                  <Text className="text-gray-500 text-xs uppercase tracking-wider font-instrument-semibold">
                    Website intel (read-only)
                  </Text>
                  <Text className="text-gray-400 text-xs font-instrument">
                    Domain: {prospect.website_intel_snapshot.normalized_domain_key}
                    {prospect.website_intel_snapshot.hit ? ' · cached hit' : ''}
                  </Text>
                  {prospect.website_intel_snapshot.extracted_profile?.business_summary ? (
                    <Text className="text-gray-300 text-xs font-instrument mt-1" numberOfLines={4}>
                      {prospect.website_intel_snapshot.extracted_profile.business_summary}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <View className="flex-row flex-wrap gap-2 items-center mt-2">
                <Button
                  size="sm"
                  onPress={handleSaveProspectRow}
                  disabled={savingProspect || !prospectRowDirty}
                >
                  {savingProspect ? 'Saving…' : 'Save prospect'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={handleDiscardProspectRow}
                  disabled={!prospectRowDirty}
                >
                  Discard
                </Button>
                {prospectRowDirty ? (
                  <Text className="text-amber-200/90 text-xs font-instrument">Unsaved prospect changes</Text>
                ) : null}
              </View>
            </View>
          )}

          {hasPageConfig && page && draftPageConfig && campaign && (
            <>
              <Tabs
                tabs={PROSPECT_EDITOR_TABS}
                activeTab={editorTab}
                onTabChange={(tabId) => setEditorTab(tabId as ProspectEditorTab)}
                layout="equal"
                marginBottom={12}
                color="indigo"
              />

              {editorTab === 'manual' ? (
                <View className="gap-3">
                  <FluxProspectPageManualEditor
                    pageConfig={draftPageConfig}
                    onChange={setDraftPageConfig}
                    contentAssets={template?.content_assets ?? []}
                    campaignId={campaign.id}
                    requestedEditingBlockId={requestedEditingBlockId}
                    issueCountByBlockId={pageIssueCountByBlockId}
                    prospectLeadSlot={
                      prospectDraft ? (
                        <FluxProspectDetailsFields
                          partition="prospect_only"
                          hideSectionTitles
                          variant="embedded"
                          showBrandProfile={false}
                          showApplyToPage
                          onApplyFieldToPage={applyProspectFieldToPage}
                          values={prospectDraft}
                          onChange={patchProspectDraft}
                          inputClassName="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
                          labelClassName="text-gray-400 text-xs font-instrument mb-1"
                        />
                      ) : null
                    }
                    prospectBrandSlot={
                      prospectDraft ? (
                        <View className="gap-2">
                          <FluxProspectDetailsFields
                            partition="brand_only"
                            hideSectionTitles
                            variant="embedded"
                            showBrandProfile
                            showApplyToPage
                            onApplyFieldToPage={applyProspectFieldToPage}
                            values={prospectDraft}
                            onChange={patchProspectDraft}
                            inputClassName="text-white text-sm font-instrument bg-[#222] border border-[#333] rounded-lg px-3 py-2 mb-2"
                            labelClassName="text-gray-400 text-xs font-instrument mb-1"
                          />
                          {prospect.website_intel_snapshot ? (
                            <View className="mt-2 border border-[#2A2A2A] rounded-xl p-3 gap-1">
                              <Text className="text-gray-500 text-xs uppercase tracking-wider font-instrument-semibold">
                                Website intel (read-only)
                              </Text>
                              <Text className="text-gray-400 text-xs font-instrument">
                                Domain: {prospect.website_intel_snapshot.normalized_domain_key}
                                {prospect.website_intel_snapshot.hit ? ' · cached hit' : ''}
                              </Text>
                              {prospect.website_intel_snapshot.extracted_profile?.business_summary ? (
                                <Text className="text-gray-300 text-xs font-instrument mt-1" numberOfLines={4}>
                                  {prospect.website_intel_snapshot.extracted_profile.business_summary}
                                </Text>
                              ) : null}
                            </View>
                          ) : null}
                          <View className="flex-row flex-wrap gap-2 items-center mt-2">
                            <Button
                              size="sm"
                              onPress={handleSaveProspectRow}
                              disabled={savingProspect || !prospectRowDirty}
                            >
                              {savingProspect ? 'Saving…' : 'Save prospect'}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onPress={handleDiscardProspectRow}
                              disabled={!prospectRowDirty}
                            >
                              Discard
                            </Button>
                            {prospectRowDirty ? (
                              <Text className="text-amber-200/90 text-xs font-instrument">
                                Unsaved prospect changes
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      ) : null
                    }
                  />
                  {pageSaveIssues.length > 0 ? (
                    <View className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-3 gap-2">
                      <Text className="text-amber-100 text-sm font-instrument-semibold">
                        Fix before saving
                      </Text>
                      <Text className="text-amber-100/90 text-xs font-instrument leading-5">
                        These copy limits are enforced by the current page layout. Open a block below to shorten the
                        flagged fields.
                      </Text>
                      {hasCopyBudgetIssues ? (
                        <View className="pt-0.5">
                          <Button size="xs" variant="secondary" onPress={() => handleToggleAllowLongCopy(true)}>
                            Allow long copy for this page
                          </Button>
                        </View>
                      ) : null}
                      <View className="gap-2">
                        {parsedPageSaveIssues.map((issue, index) => (
                          <View
                            key={`${issue.blockId ?? 'page'}-${issue.fieldLabel}-${index}`}
                            className="border border-amber-500/20 rounded-lg px-3 py-2 bg-black/10 gap-1.5"
                          >
                            <Text className="text-amber-50 text-xs font-instrument-semibold">
                              {issue.blockLabel} · {issue.fieldLabel}
                            </Text>
                            <Text className="text-amber-100/85 text-xs font-instrument leading-5">
                              {issue.detail}
                            </Text>
                            {issue.blockId ? (
                              <View className="pt-0.5">
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  onPress={() => handleOpenIssue(issue.blockId)}
                                >
                                  Open block
                                </Button>
                              </View>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {draftPageConfig.theme.allowLongCopy ? (
                    <View className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-3 gap-2">
                      <Text className="text-amber-100 text-sm font-instrument-semibold">
                        Long-copy override enabled
                      </Text>
                      <Text className="text-amber-100/90 text-xs font-instrument leading-5">
                        This page can save copy that exceeds the normal layout limits. Use this sparingly since tighter
                        presets may overflow.
                      </Text>
                      <View className="pt-0.5">
                        <Button size="xs" variant="secondary" onPress={() => handleToggleAllowLongCopy(false)}>
                          Re-enable copy limits
                        </Button>
                      </View>
                    </View>
                  ) : null}
                  <View className="flex-row flex-wrap gap-2 items-center">
                    <Button size="sm" onPress={handleSavePage} disabled={savingPage || !pageDirty}>
                      {savingPage ? 'Saving…' : 'Save page'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={handleDiscardPage}
                      disabled={!pageDirty}
                    >
                      Discard edits
                    </Button>
                    {pageDirty ? (
                      <Text className="text-amber-200/90 text-xs font-instrument">Unsaved changes</Text>
                    ) : null}
                  </View>
                </View>
              ) : (
                <View className="flex-1" style={{ minHeight: 280 }}>
                  <FluxChatPanel
                    messages={prospectChat.messages}
                    lastSummary={prospectChat.lastSummary}
                    sending={chatSending}
                    error={chatError}
                    chatConfigured={fluxEditorChatConfigured}
                    rewindableMessageIds={Object.keys(prospectChat.checkpoints)}
                    emptyStateText="Ask for copy tweaks, theme adjustments, or block reordering. Flux only edits this page—not the campaign template."
                    composerPlaceholder="Refine this prospect page…"
                    onSend={handleChatSend}
                    onRewindMessage={handleChatRewind}
                  />
                </View>
              )}
            </>
          )}

        </>
      )}
      preview={(
        previewLiveConfig && page ? (
          <PageRenderer
            config={previewLiveConfig}
            assets={template?.content_assets || []}
            scrollable={false}
          />
        ) : (
          <View className="py-12 px-6 items-center justify-center min-h-[200px]">
            <Text className="text-gray-500 text-sm font-instrument text-center">
              {page
                ? 'Generate the page to see a live preview here.'
                : 'No prospect page yet.'}
            </Text>
          </View>
        )
      )}
    />
  );
}
