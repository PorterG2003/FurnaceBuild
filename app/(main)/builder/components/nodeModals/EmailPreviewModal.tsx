import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { buildCampaignEmailContent, sanitizeEmailBody, hasMissingValues, type LeadLike } from '@/lib/email/index';
import { getLeads, getLeadCount } from '@/lib/supabase/services/leads';
import type { Lead } from '@/lib/supabase/types';
import { debounce } from '@/lib/utils/debounce';

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

export interface EmailPreviewConfig {
  subject: string;
  body_html?: string;
  body_text?: string;
  template: string;
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

function EmailPreviewModal({
  visible,
  onClose,
  config,
  campaignId,
  variableKeys,
}: EmailPreviewModalProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadSearch, setLeadSearch] = useState('');
  const lastFetchedSearchRef = useRef<string | undefined>(undefined);

  const hasVariables = (variableKeys?.length ?? 0) > 0;

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
    return () => { cancelled = true; };
  }, [visible, campaignId, hasVariables, variableKeys]);

  const fetchLeads = useCallback(
    (search: string, missingOnly: boolean) => {
      if (!campaignId) return;
      setLeadsLoading(true);
      getLeads({
        campaignId,
        limit: PREVIEW_LEAD_LIMIT,
        search: search.trim() || undefined,
        missingFields: missingOnly && variableKeys?.length ? variableKeys : undefined,
      })
        .then((data) => {
          setLeads(data);
          const nextId = data.length > 0 ? data[0].id : null;
          setSelectedLeadId(nextId);
          setSelectedLead(data.length > 0 ? data[0] : null);
        })
        .catch(() => setLeads([]))
        .finally(() => setLeadsLoading(false));
    },
    [campaignId, variableKeys]
  );

  const debouncedSearchLeads = useMemo(
    () => debounce((search: string, missingOnly: boolean) => fetchLeads(search, missingOnly), 300),
    [fetchLeads]
  );

  // Re-fetch when visibility, search, or filter toggle changes
  useEffect(() => {
    if (!visible || !campaignId || showMissingOnly === null) {
      if (!visible) {
        setLeads([]);
        setSelectedLeadId(null);
        setSelectedLead(null);
        setLeadSearch('');
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
  }, [visible, campaignId, leadSearch, showMissingOnly, fetchLeads, debouncedSearchLeads, hasVariables]);

  const resolvedLead: LeadLike = useMemo(() => {
    if (!selectedLeadId) return SAMPLE_LEAD;
    if (selectedLead?.id === selectedLeadId) return selectedLead as LeadLike;
    const found = leads.find((l) => l.id === selectedLeadId);
    return found ? (found as LeadLike) : SAMPLE_LEAD;
  }, [selectedLeadId, selectedLead, leads]);

  const content = useMemo(() => {
    if (!config) return null;
    return buildCampaignEmailContent(
      {
        subject: config.subject,
        body_html: config.body_html,
        body_text: config.body_text,
        template: config.template,
      },
      resolvedLead,
      { deterministic: true }
    );
  }, [config, resolvedLead]);

  const safeHtml = useMemo(() => {
    if (!content?.isHtmlBody || !content.bodyMerged) return '';
    const raw = content.bodyMerged;
    return stripScripts(
      sanitizeEmailBody(sanitizeEmailBody(raw, { format: 'html' }), { format: 'html' })
    );
  }, [content?.isHtmlBody, content?.bodyMerged]);

  const footer = (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
      <TouchableOpacity
        onPress={onClose}
        className="border border-[#3A3A3A] rounded-xl px-6 py-3 items-center justify-center"
        style={{ borderWidth: 1, borderColor: '#3A3A3A' }}
      >
        <Text className="text-white font-instrument-medium text-base">Close</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Preview message"
      description="Select a lead to see the merged subject and body."
      footer={footer}
      maxWidth="4xl"
      maxHeight={typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.85) : 800}
    >
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 400, gap: 16 }}>
        {/* Left panel: leads list */}
        <View style={{ width: 280, minWidth: 280, borderRightWidth: 1, borderColor: '#2A2A2A', paddingRight: 16 }}>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Leads</Text>
          {hasVariables && showMissingOnly !== null && (
            <View style={{ flexDirection: 'row', marginBottom: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#2A2A2A' }}>
              <TouchableOpacity
                onPress={() => setShowMissingOnly(true)}
                style={{
                  flex: 1,
                  paddingVertical: 6,
                  alignItems: 'center',
                  backgroundColor: showMissingOnly ? 'rgba(245,158,11,0.2)' : 'transparent',
                }}
              >
                <Text
                  className="text-xs font-instrument-medium"
                  style={{ color: showMissingOnly ? '#F59E0B' : '#9CA3AF' }}
                >
                  Missing values
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowMissingOnly(false)}
                style={{
                  flex: 1,
                  paddingVertical: 6,
                  alignItems: 'center',
                  backgroundColor: !showMissingOnly ? 'rgba(255,255,255,0.08)' : 'transparent',
                }}
              >
                <Text
                  className="text-xs font-instrument-medium"
                  style={{ color: !showMissingOnly ? '#FFFFFF' : '#9CA3AF' }}
                >
                  All leads
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {campaignId ? (
            <>
              <ScrollView
                style={{ maxHeight: 320 }}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
                {leadsLoading && leads.length === 0 ? (
                  <Text className="text-gray-500 text-sm">Loading…</Text>
                ) : leads.length === 0 ? (
                  showMissingOnly && hasVariables ? (
                    <Text className="text-gray-500 text-sm">
                      All leads have values for the variables you're using.
                    </Text>
                  ) : (
                    <Text className="text-gray-500 text-sm">
                      No leads in this campaign. Using sample lead for preview.
                    </Text>
                  )
                ) : (
                  leads.map((lead) => {
                    const isSelected = lead.id === selectedLeadId;
                    const isMissing = hasVariables && variableKeys
                      ? hasMissingValues(lead as LeadLike, variableKeys)
                      : false;
                    return (
                      <TouchableOpacity
                        key={lead.id}
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
                          <View style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: '#F59E0B',
                            marginRight: 8,
                            flexShrink: 0,
                          }} />
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
                  })
                )}
              </ScrollView>
            </>
          ) : (
            <Text className="text-gray-500 text-sm">Connect a lead bucket to preview with real leads.</Text>
          )}
        </View>

        {/* Right panel: merged message */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Message</Text>
          {content ? (
            <View style={{ backgroundColor: '#141414', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', padding: 16, flex: 1 }}>
              <Text className="text-xs font-instrument-medium text-gray-400 mb-1">Subject</Text>
              <Text className="text-white text-sm mb-4" numberOfLines={2}>
                {content.subject || '(empty)'}
              </Text>
              <Text className="text-xs font-instrument-medium text-gray-400 mb-1">Body</Text>
              <ScrollView
                style={{ flex: 1, maxHeight: 360 }}
                showsVerticalScrollIndicator
                nestedScrollEnabled
              >
                {content.isHtmlBody && Platform.OS === 'web' && safeHtml ? (
                  React.createElement('div', {
                    className: 'message-body-html',
                    dangerouslySetInnerHTML: { __html: `<div>${safeHtml}</div>` },
                    style: { flex: 1 },
                  })
                ) : (
                  <Text className="text-gray-300 text-sm whitespace-pre-wrap">
                    {content.bodyMerged || '(empty)'}
                  </Text>
                )}
              </ScrollView>
            </View>
          ) : (
            <Text className="text-gray-500 text-sm">No content to preview. Edit the email and click Preview.</Text>
          )}
        </View>
      </View>
    </BaseModal>
  );
}

export { EmailPreviewModal };
export default EmailPreviewModal;
