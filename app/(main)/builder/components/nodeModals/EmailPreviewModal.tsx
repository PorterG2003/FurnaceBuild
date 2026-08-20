import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { MagnifyingGlassIcon } from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Tabs, type Tab } from '@/components/ui/tabs';
import {
  PlatformInvitePreviewFrame,
  type PlatformInvitePreviewViewport,
} from '@/components/platform/invite/PlatformInvitePreviewFrame';
import {
  buildCampaignEmailContent,
  buildSpintaxSeed,
  hasMissingValues,
  isolateEmailHtmlForRender,
  isFullHtmlDocument,
  sanitizeEmailBody,
  type EmailEditorMode,
  type LeadLike,
} from '@/lib/email/index';
import { getCampaignMailboxes } from '@/lib/supabase/services/campaigns';
import { getLeads, getLeadCount } from '@/lib/supabase/services/leads';
import type { Lead } from '@/lib/supabase/types';
import { debounce } from '@/lib/utils/debounce';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout/constants';
import { MessageBody } from '@/components/inbox/MessageBody';

/** Strip script tags from HTML for safe rendering. */
function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

const SAMPLE_LEAD: LeadLike = {
  email: 'alex@example.com',
  name: 'Alex Smith',
  first_name: 'Alex',
  last_name: 'Smith',
  company_name: 'Acme Inc',
  website: 'https://acme.com',
  linkedin_url: 'https://linkedin.com/in/alex',
  company_linkedin_url: 'https://linkedin.com/company/acme',
  source: 'Preview',
};

const LEAD_FILTER_TABS: Tab[] = [
  { id: 'missing', label: 'Missing values' },
  { id: 'all', label: 'All leads' },
];

const VIEWPORT_TABS: Tab[] = [
  { id: 'mobile', label: 'Mobile' },
  { id: 'desktop', label: 'Desktop' },
];

export interface EmailPreviewConfig {
  subject: string;
  body_html?: string;
  body_text?: string;
  template: string;
  editor_mode?: EmailEditorMode;
  /** Stable A/B variant UUID; required for preview/send spintax seed parity. */
  variantId?: string;
}

interface EmailPreviewModalProps {
  visible: boolean;
  onClose: () => void;
  config: EmailPreviewConfig | null;
  campaignId?: string;
  /** Variable keys used in the template (e.g. ["first_name", "custom.role"]) */
  variableKeys?: string[];
}

const PREVIEW_LEAD_LIMIT = 50;

function MissingSignatureBanner() {
  return (
    <View
      style={{
        backgroundColor: 'rgba(75, 85, 99, 0.25)',
        borderWidth: 1,
        borderColor: 'rgba(75, 85, 99, 0.5)',
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginTop: 16,
        borderStyle: 'dashed',
      }}
    >
      <Text className="text-gray-500 text-xs font-instrument" style={{ fontStyle: 'italic' }}>
        Signature will appear here once mailboxes are assigned to this campaign.
      </Text>
    </View>
  );
}

function EmailPreviewModal({
  visible,
  onClose,
  config,
  campaignId,
  variableKeys,
}: EmailPreviewModalProps) {
  const { width: windowWidth } = useWindowDimensions();
  const isMobileLayout = windowWidth < LAYOUT_BREAKPOINT;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsLoadingMore, setLeadsLoadingMore] = useState(false);
  const [hasMoreLeads, setHasMoreLeads] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadSearch, setLeadSearch] = useState('');
  const lastFetchedSearchRef = useRef<string | undefined>(undefined);
  const leadsFetchGenRef = useRef(0);
  const loadingMoreRef = useRef(false);
  /** Signature from first campaign mailbox (for preview). */
  const [previewSignature, setPreviewSignature] = useState<string | null>(null);
  const [previewViewport, setPreviewViewport] =
    useState<PlatformInvitePreviewViewport>('mobile');
  const [messagePaneWidth, setMessagePaneWidth] = useState(0);
  const [previewViewportHeight, setPreviewViewportHeight] = useState(0);

  const hasVariables = (variableKeys?.length ?? 0) > 0;
  const showMissingSignatureBanner = Boolean(campaignId) && !previewSignature;

  // Fetch first campaign mailbox signature when preview opens and we have a campaign
  useEffect(() => {
    if (!visible || !campaignId) {
      setPreviewSignature(null);
      return;
    }
    let cancelled = false;
    getCampaignMailboxes(campaignId)
      .then((mailboxes) => {
        if (cancelled) return;
        const first = mailboxes?.[0];
        const sig = first?.signature;
        setPreviewSignature(sig && String(sig).trim() ? String(sig).trim() : null);
      })
      .catch(() => {
        if (!cancelled) setPreviewSignature(null);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, campaignId]);

  // null = not yet determined (count query in progress)
  const [showMissingOnly, setShowMissingOnly] = useState<boolean | null>(null);

  // Smart default: run count query on open to decide filter default
  useEffect(() => {
    if (!visible || !campaignId || !hasVariables) {
      setShowMissingOnly(hasVariables ? null : false);
      return;
    }
    let cancelled = false;
    getLeadCount({ campaignId, missingFields: variableKeys })
      .then((count) => {
        if (!cancelled) setShowMissingOnly(count > 0);
      })
      .catch(() => {
        if (!cancelled) setShowMissingOnly(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, campaignId, hasVariables, variableKeys]);

  const fetchLeadsPage = useCallback(
    async (params: {
      search: string;
      missingOnly: boolean;
      offset: number;
      mode: 'replace' | 'append';
      gen: number;
    }) => {
      if (!campaignId) return;
      const { search, missingOnly, offset, mode, gen } = params;
      if (mode === 'replace') {
        setLeadsLoading(true);
        setHasMoreLeads(false);
      } else {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLeadsLoadingMore(true);
      }

      try {
        const data = await getLeads({
          campaignId,
          limit: PREVIEW_LEAD_LIMIT,
          offset,
          search: search.trim() || undefined,
          missingFields: missingOnly && variableKeys?.length ? variableKeys : undefined,
        });
        if (leadsFetchGenRef.current !== gen) return;

        setHasMoreLeads(data.length === PREVIEW_LEAD_LIMIT);
        if (mode === 'replace') {
          setLeads(data);
          const nextId = data.length > 0 ? data[0]!.id : null;
          setSelectedLeadId(nextId);
          setSelectedLead(data.length > 0 ? data[0]! : null);
        } else {
          setLeads((prev) => {
            const seen = new Set(prev.map((lead) => lead.id));
            const appended = data.filter((lead) => !seen.has(lead.id));
            return appended.length > 0 ? [...prev, ...appended] : prev;
          });
        }
      } catch {
        if (leadsFetchGenRef.current !== gen) return;
        if (mode === 'replace') {
          setLeads([]);
          setSelectedLeadId(null);
          setSelectedLead(null);
          setHasMoreLeads(false);
        }
      } finally {
        if (leadsFetchGenRef.current === gen) {
          if (mode === 'replace') setLeadsLoading(false);
          else {
            loadingMoreRef.current = false;
            setLeadsLoadingMore(false);
          }
        } else if (mode === 'append') {
          loadingMoreRef.current = false;
          setLeadsLoadingMore(false);
        }
      }
    },
    [campaignId, variableKeys]
  );

  const fetchLeads = useCallback(
    (search: string, missingOnly: boolean) => {
      const gen = ++leadsFetchGenRef.current;
      loadingMoreRef.current = false;
      void fetchLeadsPage({
        search,
        missingOnly,
        offset: 0,
        mode: 'replace',
        gen,
      });
    },
    [fetchLeadsPage]
  );

  const loadMoreLeads = useCallback(() => {
    if (!campaignId || showMissingOnly === null) return;
    if (!hasMoreLeads || leadsLoading || leadsLoadingMore || loadingMoreRef.current) return;
    const gen = leadsFetchGenRef.current;
    void fetchLeadsPage({
      search: leadSearch,
      missingOnly: showMissingOnly,
      offset: leads.length,
      mode: 'append',
      gen,
    });
  }, [
    campaignId,
    fetchLeadsPage,
    hasMoreLeads,
    leadSearch,
    leads.length,
    leadsLoading,
    leadsLoadingMore,
    showMissingOnly,
  ]);

  const debouncedSearchLeads = useMemo(
    () => debounce((search: string, missingOnly: boolean) => fetchLeads(search, missingOnly), 300),
    [fetchLeads]
  );

  // Re-fetch when visibility, search, or filter toggle changes
  useEffect(() => {
    if (!visible || !campaignId || showMissingOnly === null) {
      if (!visible) {
        leadsFetchGenRef.current += 1;
        loadingMoreRef.current = false;
        setLeads([]);
        setSelectedLeadId(null);
        setSelectedLead(null);
        setLeadSearch('');
        setHasMoreLeads(false);
        setLeadsLoadingMore(false);
        lastFetchedSearchRef.current = undefined;
        setShowMissingOnly(hasVariables ? null : false);
      }
      return;
    }
    const searchKey = `${leadSearch}|${showMissingOnly}`;
    if (lastFetchedSearchRef.current === searchKey) return;
    lastFetchedSearchRef.current = searchKey;
    if (leadSearch.trim() === '') {
      fetchLeads('', showMissingOnly);
    } else {
      debouncedSearchLeads(leadSearch, showMissingOnly);
    }
  }, [
    visible,
    campaignId,
    leadSearch,
    showMissingOnly,
    fetchLeads,
    debouncedSearchLeads,
    hasVariables,
  ]);

  const resolvedLead: LeadLike = useMemo(() => {
    if (!selectedLeadId) return SAMPLE_LEAD;
    if (selectedLead?.id === selectedLeadId) return selectedLead as LeadLike;
    const found = leads.find((l) => l.id === selectedLeadId);
    return found ? (found as LeadLike) : SAMPLE_LEAD;
  }, [selectedLeadId, selectedLead, leads]);

  const content = useMemo(() => {
    if (!config) return null;
    const leadIdForSeed =
      selectedLeadId && resolvedLead !== SAMPLE_LEAD ? selectedLeadId : null;
    const canSeed =
      Boolean(campaignId) && Boolean(leadIdForSeed) && Boolean(config.variantId);
    const result = buildCampaignEmailContent(
      {
        subject: config.subject,
        body_html: config.body_html,
        body_text: config.body_text,
        template: config.template,
        editor_mode: config.editor_mode,
        signature: previewSignature ?? undefined,
      },
      resolvedLead,
      canSeed
        ? {
            seed: buildSpintaxSeed({
              campaignId: campaignId!,
              leadId: leadIdForSeed!,
              variantId: config.variantId,
            }),
          }
        : { deterministic: true }
    );
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      console.log('[EmailPreviewModal] previewSignature', {
        hasSignature: !!previewSignature,
        length: previewSignature?.length,
        snippet: previewSignature?.slice(0, 100),
      });
      console.log('[EmailPreviewModal] content', {
        isHtmlBody: result.isHtmlBody,
        bodyMergedLength: result.bodyMerged?.length,
        bodyMergedSnippet: result.bodyMerged?.slice(-200),
      });
    }
    return result;
  }, [config, resolvedLead, previewSignature, campaignId, selectedLeadId]);

  const safeHtml = useMemo(() => {
    if (!content?.isHtmlBody || !content.bodyMerged) return '';
    const raw = content.bodyMerged;
    return stripScripts(
      sanitizeEmailBody(sanitizeEmailBody(raw, { format: 'html' }), { format: 'html' })
    );
  }, [content?.isHtmlBody, content?.bodyMerged]);
  const renderFullDocument = useMemo(
    () => !!safeHtml && isFullHtmlDocument(safeHtml),
    [safeHtml]
  );
  const useHtmlDevicePreview = config?.editor_mode === 'html';

  const renderLeadItem = useCallback(
    ({ item: lead }: { item: Lead }) => {
      const isSelected = lead.id === selectedLeadId;
      const isMissing =
        hasVariables && variableKeys
          ? hasMissingValues(lead as LeadLike, variableKeys)
          : false;
      return (
        <TouchableOpacity
          onPress={() => {
            setSelectedLeadId(lead.id);
            setSelectedLead(lead);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 8,
            marginBottom: 4,
            backgroundColor: isSelected ? 'rgba(243,68,13,0.15)' : 'transparent',
            borderWidth: 1,
            borderColor: isSelected ? 'rgba(243,68,13,0.4)' : 'transparent',
          }}
        >
          {isMissing && !showMissingOnly && (
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: '#F59E0B',
                marginRight: 8,
                flexShrink: 0,
              }}
            />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text className="text-white font-instrument text-sm" numberOfLines={1}>
              {lead.email ?? lead.name ?? lead.id}
            </Text>
            {(lead.first_name || lead.last_name || lead.name) && (
              <Text className="text-gray-500 text-xs mt-0.5" numberOfLines={1}>
                {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.name}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [hasVariables, selectedLeadId, showMissingOnly, variableKeys]
  );

  const modalHeight =
    typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.85) : 800;

  const footer = (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
      <Button variant="secondary" onPress={onClose}>
        <Text>Close</Text>
      </Button>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Preview message"
      description="Select a lead to see the merged subject and body."
      footer={footer}
      maxWidth="6xl"
      height={modalHeight}
      bodyScroll={false}
    >
      <View
        style={{
          flex: 1,
          flexDirection: isMobileLayout ? 'column' : 'row',
          minHeight: 0,
          gap: 16,
        }}
      >
        {/* Left panel: leads list */}
        <View
          style={{
            width: isMobileLayout ? '100%' : 280,
            minWidth: isMobileLayout ? 0 : 280,
            flexShrink: 0,
            flexDirection: 'column',
            height: isMobileLayout ? 260 : undefined,
            alignSelf: 'stretch',
            minHeight: 0,
            overflow: 'hidden',
            borderRightWidth: isMobileLayout ? 0 : 1,
            borderBottomWidth: isMobileLayout ? 1 : 0,
            borderColor: '#2A2A2A',
            paddingRight: isMobileLayout ? 0 : 16,
            paddingBottom: isMobileLayout ? 12 : 0,
          }}
        >
          {hasVariables && showMissingOnly !== null ? (
            <View style={{ flexShrink: 0, width: '100%' }}>
              <Tabs
                tabs={LEAD_FILTER_TABS}
                activeTab={showMissingOnly ? 'missing' : 'all'}
                onTabChange={(tabId) => setShowMissingOnly(tabId === 'missing')}
                layout="equal"
                marginBottom={0}
              />
            </View>
          ) : null}
          {campaignId ? (
            <View
              className="flex-row items-center bg-[#121212] border border-[#2A2A2A] px-3 py-2"
              style={{
                flexShrink: 0,
                width: '100%',
                borderRadius: 12,
                marginTop: hasVariables && showMissingOnly !== null ? 8 : 0,
                marginBottom: 8,
              }}
            >
              <MagnifyingGlassIcon size={18} color="#6B7280" style={{ marginRight: 8 }} />
              <TextInput
                value={leadSearch}
                onChangeText={setLeadSearch}
                placeholder="Search leads…"
                placeholderTextColor="#6B7280"
                className="flex-1 text-white font-instrument text-sm py-1"
                style={{ color: '#FFFFFF' }}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ) : null}
          {campaignId ? (
            <FlatList
              data={leads}
              keyExtractor={(lead) => lead.id}
              renderItem={renderLeadItem}
              style={{ flex: 1, minHeight: 0 }}
              contentContainerStyle={
                leads.length === 0 ? { flexGrow: 1, justifyContent: 'flex-start' } : undefined
              }
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              onEndReached={loadMoreLeads}
              onEndReachedThreshold={0.4}
              ListEmptyComponent={
                leadsLoading ? (
                  <Text className="text-gray-500 text-sm">Loading…</Text>
                ) : showMissingOnly && hasVariables ? (
                  <Text className="text-gray-500 text-sm">
                    All leads have values for the variables you're using.
                  </Text>
                ) : (
                  <Text className="text-gray-500 text-sm">
                    No leads in this campaign. Using sample lead for preview.
                  </Text>
                )
              }
              ListFooterComponent={
                leadsLoadingMore ? (
                  <Text className="text-gray-500 text-xs py-2">Loading more…</Text>
                ) : null
              }
            />
          ) : (
            <Text className="text-gray-500 text-sm">
              Connect a lead bucket to preview with real leads.
            </Text>
          )}
        </View>

        {/* Right panel: merged message */}
        <View
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            flexDirection: 'column',
            alignSelf: 'stretch',
          }}
          onLayout={
            useHtmlDevicePreview
              ? (event) => {
                  const nextWidth = event.nativeEvent.layout.width;
                  if (Math.abs(nextWidth - messagePaneWidth) > 1) {
                    setMessagePaneWidth(nextWidth);
                  }
                }
              : undefined
          }
        >
          {content ? (
            <View
              style={{
                backgroundColor: '#141414',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#2A2A2A',
                padding: 16,
                flex: 1,
                minHeight: 0,
                flexDirection: 'column',
              }}
            >
              <View style={{ flexShrink: 0 }}>
                <Text className="text-xs font-instrument-medium text-gray-400 mb-1">Subject</Text>
                <Text className="text-white text-sm mb-4" numberOfLines={2}>
                  {content.subject || '(empty)'}
                </Text>
                <View
                  style={{
                    flexDirection: useHtmlDevicePreview && !isMobileLayout ? 'row' : 'column',
                    alignItems: useHtmlDevicePreview && !isMobileLayout ? 'center' : 'stretch',
                    justifyContent: useHtmlDevicePreview ? 'space-between' : 'flex-start',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text className="text-xs font-instrument-medium text-gray-400">Body</Text>
                  {useHtmlDevicePreview ? (
                    <View style={{ width: isMobileLayout ? '100%' : 220 }}>
                      <Tabs
                        tabs={VIEWPORT_TABS}
                        activeTab={previewViewport}
                        onTabChange={(tabId) =>
                          setPreviewViewport(tabId as PlatformInvitePreviewViewport)
                        }
                        layout="equal"
                        marginBottom={0}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
              <ScrollView
                style={{ flex: 1, minHeight: 0 }}
                showsVerticalScrollIndicator
                nestedScrollEnabled
                contentContainerStyle={{ flexGrow: 1, paddingBottom: 8 }}
              >
                <View
                  style={{
                    minHeight: useHtmlDevicePreview ? 260 : undefined,
                    flexGrow: useHtmlDevicePreview ? 1 : undefined,
                  }}
                  onLayout={
                    useHtmlDevicePreview
                      ? (event) => {
                          const nextHeight = event.nativeEvent.layout.height;
                          if (Math.abs(nextHeight - previewViewportHeight) > 1) {
                            setPreviewViewportHeight(nextHeight);
                          }
                        }
                      : undefined
                  }
                >
                  {useHtmlDevicePreview && Platform.OS === 'web' && safeHtml ? (
                    <PlatformInvitePreviewFrame
                      variant="inline"
                      viewport={previewViewport}
                      onViewportChange={setPreviewViewport}
                      showControls={false}
                      showTitle={false}
                      availableWidth={Math.max(320, messagePaneWidth - 24)}
                      availableHeight={Math.max(260, previewViewportHeight - 8)}
                    >
                      {renderFullDocument ? (
                        React.createElement('iframe', {
                          srcDoc: safeHtml,
                          sandbox: 'allow-same-origin',
                          title: 'Email preview document',
                          style: {
                            width: '100%',
                            height: '100%',
                            border: '0',
                            backgroundColor: '#FFFFFF',
                          },
                        })
                      ) : (
                        React.createElement(
                          'div',
                          {
                            style: {
                              width: '100%',
                              height: '100%',
                              overflowY: 'auto',
                              backgroundColor: '#FFFFFF',
                              color: '#111827',
                              padding: '16px 18px',
                              boxSizing: 'border-box',
                            },
                          },
                          React.createElement('div', {
                            className: 'message-body-html',
                            dangerouslySetInnerHTML: { __html: isolateEmailHtmlForRender(safeHtml) },
                          })
                        )
                      )}
                    </PlatformInvitePreviewFrame>
                  ) : content.isHtmlBody && Platform.OS === 'web' ? (
                    <MessageBody
                      bodyHtml={content.bodyMerged}
                      bodyText={content.bodyText}
                      displayText={content.bodyText ?? content.bodyMerged}
                      disableQuotedThreadCollapse
                    />
                  ) : (
                    <Text className="text-gray-300 text-sm whitespace-pre-wrap">
                      {content.bodyMerged || '(empty)'}
                    </Text>
                  )}
                </View>
                {showMissingSignatureBanner ? <MissingSignatureBanner /> : null}
              </ScrollView>
            </View>
          ) : (
            <Text className="text-gray-500 text-sm">
              No content to preview. Edit the email and click Preview.
            </Text>
          )}
        </View>
      </View>
    </BaseModal>
  );
}

export { EmailPreviewModal };
export default EmailPreviewModal;
