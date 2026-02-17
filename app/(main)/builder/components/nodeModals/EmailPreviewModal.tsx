import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { buildCampaignEmailContent, sanitizeEmailBody, type LeadLike } from '@/lib/email/index';
import { getLeads } from '@/lib/supabase/services/leads';
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
}

const PREVIEW_LEAD_LIMIT = 50;

function EmailPreviewModal({
  visible,
  onClose,
  config,
  campaignId,
}: EmailPreviewModalProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadSearch, setLeadSearch] = useState('');
  const lastFetchedSearchRef = useRef<string | undefined>(undefined);

  const fetchLeads = useCallback(
    (search: string) => {
      if (!campaignId) return;
      setLeadsLoading(true);
      getLeads({
        campaignId,
        limit: PREVIEW_LEAD_LIMIT,
        search: search.trim() || undefined,
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
    [campaignId]
  );

  const debouncedSearchLeads = useMemo(
    () => debounce((search: string) => fetchLeads(search), 300),
    [fetchLeads]
  );

  useEffect(() => {
    if (!visible || !campaignId) {
      setLeads([]);
      setSelectedLeadId(null);
      setSelectedLead(null);
      setLeadSearch('');
      lastFetchedSearchRef.current = undefined;
      return;
    }
    if (lastFetchedSearchRef.current === leadSearch) return;
    lastFetchedSearchRef.current = leadSearch;
    if (leadSearch.trim() === '') {
      fetchLeads('');
    } else {
      debouncedSearchLeads(leadSearch);
    }
  }, [visible, campaignId, leadSearch, fetchLeads, debouncedSearchLeads]);

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
                  <Text className="text-gray-500 text-sm">
                    No leads in this campaign. Using sample lead for preview.
                  </Text>
                ) : (
                  leads.map((lead) => {
                    const isSelected = lead.id === selectedLeadId;
                    return (
                      <TouchableOpacity
                        key={lead.id}
                        onPress={() => {
                          setSelectedLeadId(lead.id);
                          setSelectedLead(lead);
                        }}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderRadius: 8,
                          marginBottom: 4,
                          backgroundColor: isSelected ? 'rgba(243,68,13,0.15)' : 'transparent',
                          borderWidth: 1,
                          borderColor: isSelected ? 'rgba(243,68,13,0.4)' : 'transparent',
                        }}
                      >
                        <Text className="text-white font-instrument text-sm" numberOfLines={1}>
                          {lead.email ?? lead.name ?? lead.id}
                        </Text>
                        {(lead.first_name || lead.last_name || lead.name) && (
                          <Text className="text-gray-500 text-xs mt-0.5" numberOfLines={1}>
                            {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.name}
                          </Text>
                        )}
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
