import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { CodeBracketIcon } from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { EmailBodyEditor } from '../EmailBodyEditor';
import { getLeads } from '@/lib/supabase/services/leads';
import { mergeTemplate, processSpintax, type LeadLike } from '@/lib/email';
import type { Lead } from '@/lib/supabase/types';
import { debounce } from '@/lib/utils/debounce';

type LeadVariable = { token: string; description: string };

interface VariableMenuProps {
  variables: LeadVariable[];
  width?: number;
  maxHeight?: number;
  anchorOffset?: number;
  onSelect: (token: string) => void;
}

const VariableMenu = ({
  variables,
  width = 240,
  maxHeight = 280,
  anchorOffset = 52,
  onSelect,
}: VariableMenuProps) => (
  <View
    style={{
      position: 'absolute',
      top: anchorOffset,
      right: 0,
      width,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
      backgroundColor: '#141414',
      paddingVertical: 6,
      paddingHorizontal: 6,
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 12 },
      elevation: 12,
      zIndex: 200,
      maxHeight,
      overflow: 'hidden',
    }}
  >
    <ScrollView
      showsVerticalScrollIndicator
      style={{ maxHeight: maxHeight - 12 }}
      contentContainerStyle={{ paddingVertical: 4 }}
    >
      {variables.map((variable, index) => (
        <TouchableOpacity
          key={variable.token}
          onPress={() => onSelect(variable.token)}
          style={{
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: '#262626',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            marginBottom: index === variables.length - 1 ? 0 : 8,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontFamily: 'Instrument Sans, system-ui, sans-serif', fontWeight: '600' }}>
            {variable.token}
          </Text>
          <Text style={{ color: '#9CA3AF', fontSize: 11, marginTop: 3, fontFamily: 'Instrument Sans, system-ui, sans-serif' }}>
            {variable.description}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
);

interface VariableInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  minHeight?: number;
  variant?: 'subject' | 'body';
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onRequestCloseMenu: () => void;
  variables: LeadVariable[];
}

const VariableInput = ({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  minHeight,
  variant = 'body',
  isMenuOpen,
  onToggleMenu,
  onRequestCloseMenu,
  variables,
}: VariableInputProps) => {
  const handleSelectVariable = (token: string) => {
    const currentValue = value || '';

    const nextValue =
      variant === 'subject'
        ? currentValue
          ? `${currentValue}${currentValue.endsWith(' ') ? '' : ' '}${token}`
          : token
        : currentValue
          ? `${currentValue}${currentValue.endsWith('\n') ? '' : '\n'}${token}`
          : token;

    onChange(nextValue);
    onRequestCloseMenu();
  };

  return (
    <View
      style={{
        marginBottom: 24,
        position: 'relative',
        zIndex: isMenuOpen ? 30 : 1,
      }}
    >
      <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
        {label}
      </Text>
      <View style={{ position: 'relative', zIndex: isMenuOpen ? 40 : 1 }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => {
            if (isMenuOpen) {
              onRequestCloseMenu();
            }
          }}
          placeholder={placeholder}
          placeholderTextColor="#666"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={{
            borderColor: '#FFFFFF4D',
            backgroundColor: '#FFFFFF0D',
            color: '#FFFFFF',
            borderWidth: 1,
            paddingRight: 64,
            textAlignVertical: multiline ? 'top' : 'center',
            ...(multiline && typeof minHeight === 'number' ? { minHeight } : {}),
          }}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          multiline={multiline}
        />
        <TouchableOpacity
          onPress={onToggleMenu}
          style={{
            position: 'absolute',
            top: 7,
            right: 7,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: isMenuOpen ? 'rgba(243,68,13,0.4)' : 'rgba(255,255,255,0.16)',
            backgroundColor: isMenuOpen ? 'rgba(243,68,13,0.2)' : 'rgba(255,255,255,0.08)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CodeBracketIcon 
            size={18} 
            color={isMenuOpen ? '#F3440D' : '#FFFFFF'} 
          />
        </TouchableOpacity>
        {isMenuOpen && (
          <VariableMenu
            variables={variables}
            width={260}
            maxHeight={320}
            anchorOffset={52}
            onSelect={handleSelectVariable}
          />
        )}
      </View>
    </View>
  );
};

/** Convert plain text template to HTML for TipTap (one <p> per line). */
function templateToHtml(template: string): string {
  if (!template || !template.trim()) return '<p></p>';
  const lines = template.split(/\r?\n/);
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Check if string looks like HTML (has tags). */
function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}

/** Sample lead for preview when campaign has no leads. */
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

interface EmailNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: {
    label?: string;
    subject?: string;
    template?: string;
    body_html?: string;
    body_text?: string;
  }) => void;
  initialData?: {
    label?: string;
    subject?: string;
    template?: string;
    body_html?: string;
    body_text?: string;
    campaignId?: string;
  };
}

function EmailNodeModal({
  visible,
  onClose,
  onSave,
  initialData,
}: EmailNodeModalProps) {
  const [label, setLabel] = useState(initialData?.label || 'Send Email');
  const [subject, setSubject] = useState(initialData?.subject || '');
  const [template, setTemplate] = useState(initialData?.template || '');
  const [openMenu, setOpenMenu] = useState<'subject' | 'template' | null>(null);
  const bodyEditorRef = useRef<{ getHTML: () => string; getText: () => string } | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | 'sample' | null>(null);
  /** Selected lead object (keeps preview working when list updates e.g. after search). */
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadSearch, setLeadSearch] = useState('');
  /** Body text for live preview on web (synced from editor onUpdate). */
  const [bodyTextForPreview, setBodyTextForPreview] = useState('');

  const PREVIEW_LEAD_LIMIT = 50;

  const initialBodyContent = useMemo(() => {
    const html = initialData?.body_html;
    const tmpl = initialData?.template;
    if (html && isHtml(html)) return html;
    if (tmpl) return templateToHtml(tmpl);
    return '<p></p>';
  }, [initialData?.body_html, initialData?.template]);

  useEffect(() => {
    if (visible && initialData) {
      setLabel(initialData.label ?? 'Send Email');
      setSubject(initialData.subject ?? '');
      setTemplate(initialData.template ?? '');
      setBodyTextForPreview(initialData.template ?? '');
    }
  }, [visible, initialData]);

  const lastFetchedSearchRef = useRef<string | undefined>(undefined);

  const fetchLeads = useCallback(
    (search: string) => {
      if (!initialData?.campaignId) return;
      setLeadsLoading(true);
      getLeads({
        campaignId: initialData.campaignId,
        limit: PREVIEW_LEAD_LIMIT,
        search: search.trim() || undefined,
      })
        .then((data) => {
          setLeads(data);
          const nextId: string | 'sample' = data.length > 0 ? data[0].id : 'sample';
          setSelectedLeadId(nextId);
          setSelectedLead(data.length > 0 ? data[0] : null);
        })
        .catch(() => setLeads([]))
        .finally(() => setLeadsLoading(false));
    },
    [initialData?.campaignId]
  );

  useEffect(() => {
    if (!visible || !initialData?.campaignId) {
      setLeads([]);
      setSelectedLeadId(null);
      setSelectedLead(null);
      setLeadSearch('');
      lastFetchedSearchRef.current = undefined;
      return;
    }
  }, [visible, initialData?.campaignId]);

  const debouncedSearchLeads = useMemo(
    () => debounce((search: string) => fetchLeads(search), 300),
    [fetchLeads]
  );

  useEffect(() => {
    if (!visible || !initialData?.campaignId) return;
    if (lastFetchedSearchRef.current === leadSearch) return;
    lastFetchedSearchRef.current = leadSearch;
    if (leadSearch.trim() === '') {
      fetchLeads('');
    } else {
      debouncedSearchLeads(leadSearch);
    }
  }, [visible, initialData?.campaignId, leadSearch, fetchLeads, debouncedSearchLeads]);

  const leadVariables = useMemo(
    (): LeadVariable[] => [
      { token: '{{email}}', description: 'Lead email address' },
      { token: '{{name}}', description: 'Full name if available' },
      { token: '{{first_name}}', description: 'First name (falls back to name)' },
      { token: '{{last_name}}', description: 'Last name' },
      { token: '{{company_name}}', description: 'Company name' },
      { token: '{{website}}', description: 'Company website URL' },
      { token: '{{linkedin_url}}', description: 'Lead LinkedIn profile' },
      { token: '{{company_linkedin_url}}', description: 'Company LinkedIn profile' },
      { token: '{{source}}', description: 'Lead source' },
      { token: '{{custom.field_name}}', description: 'Custom field (replace field_name)' },
    ],
    []
  );

  const handleSave = () => {
    const bodyHtml = bodyEditorRef.current?.getHTML?.();
    const bodyText = bodyEditorRef.current?.getText?.();
    onSave({
      label,
      subject,
      template: bodyText ?? template,
      body_html: bodyHtml ?? undefined,
      body_text: bodyText ?? undefined,
    });
    onClose();
  };

  const footer = (
    <View className="flex-row gap-3">
      <View className="flex-1">
        <TouchableOpacity
          onPress={onClose}
          className="border border-[#3A3A3A] rounded-xl px-6 py-3 items-center justify-center"
          style={{
            borderWidth: 1,
            borderColor: '#3A3A3A',
          }}
        >
          <Text className="text-white font-instrument-medium text-base">
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
      <View className="flex-1">
        <Button onPress={handleSave}>
          Save
        </Button>
      </View>
    </View>
  );

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Configure Email Node"
      description="Personalize cold outreach emails using lead data from the connected bucket."
      footer={footer}
      maxWidth="4xl"
      maxHeight={900}
    >
      <View className="gap-5">
        <View>
          <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
            Label
          </Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="Node label"
            placeholderTextColor="#666"
            className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
            style={{
              borderColor: '#FFFFFF4D',
              backgroundColor: '#FFFFFF0D',
              color: '#FFFFFF',
              borderWidth: 1,
            }}
            selectionColor="#FF4D00"
            underlineColorAndroid="transparent"
          />
        </View>

        <View>
          <VariableInput
            label="Subject"
            value={subject}
            onChange={setSubject}
            placeholder="e.g. Quick idea for {{first_name}} (or leave empty to continue thread)"
            variant="subject"
            isMenuOpen={openMenu === 'subject'}
            onToggleMenu={() => setOpenMenu(prev => (prev === 'subject' ? null : 'subject'))}
            onRequestCloseMenu={() => setOpenMenu(null)}
            variables={leadVariables}
          />
          <Text className="text-xs text-gray-500 mt-1.5">
            Leave empty on follow-up emails to use the first email's subject and keep replies in the same thread.
          </Text>
        </View>

        {Platform.OS === 'web' ? (
          <EmailBodyEditor
            key={visible ? 'open' : 'closed'}
            initialContent={initialBodyContent}
            editorRef={bodyEditorRef}
            variables={leadVariables}
            placeholder="Hi {{first_name}},\n\nLoved what you're building at {{company_name}}..."
            minHeight={220}
            label="Email Body"
            onContentChange={setBodyTextForPreview}
          />
        ) : (
          <VariableInput
            label="Email Body"
            value={template}
            onChange={setTemplate}
            placeholder="Hi {{first_name}},\n\nLoved what you're building at {{company_name}}..."
            multiline
            minHeight={220}
            variant="body"
            isMenuOpen={openMenu === 'template'}
            onToggleMenu={() => setOpenMenu(prev => (prev === 'template' ? null : 'template'))}
            onRequestCloseMenu={() => setOpenMenu(null)}
            variables={leadVariables}
          />
        )}

        {initialData?.campaignId && (
          <View className="pt-4 border-t border-[#2A2A2A]">
            <Text className="text-sm font-instrument-medium mb-3 text-gray-300">
              Preview message
            </Text>
            {leadsLoading ? (
              <Text className="text-gray-500 text-sm">Loading leads…</Text>
            ) : (
              <>
                <View className="mb-3">
                  <Text className="text-xs font-instrument-medium mb-2 text-gray-400">
                    Select lead
                  </Text>
                  <TextInput
                    value={leadSearch}
                    onChangeText={setLeadSearch}
                    placeholder="Search by email or name…"
                    placeholderTextColor="#666"
                    className="border border-white/30 rounded-xl px-4 py-2.5 bg-white/5 text-sm text-white mb-2"
                    style={{
                      borderColor: '#FFFFFF4D',
                      backgroundColor: '#FFFFFF0D',
                      color: '#FFFFFF',
                      borderWidth: 1,
                    }}
                    selectionColor="#FF4D00"
                    underlineColorAndroid="transparent"
                  />
                  {leads.length === 0 && !leadsLoading ? (
                    <Text className="text-gray-500 text-sm">
                      {leadSearch.trim()
                        ? 'No leads match your search.'
                        : 'No leads in this campaign — add leads to preview with real data. Showing sample below.'}
                    </Text>
                  ) : (
                    <ScrollView
                      style={{ maxHeight: 160 }}
                      showsVerticalScrollIndicator
                      nestedScrollEnabled
                    >
                      {leads.map((lead) => (
                        <TouchableOpacity
                          key={lead.id}
                          onPress={() => {
                            setSelectedLeadId(lead.id);
                            setSelectedLead(lead);
                          }}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            borderRadius: 10,
                            borderWidth: 1,
                            marginBottom: 6,
                            backgroundColor: selectedLeadId === lead.id ? 'rgba(243,68,13,0.2)' : '#262626',
                            borderColor: selectedLeadId === lead.id ? '#F3440D' : 'rgba(255,255,255,0.12)',
                          }}
                        >
                          <Text className="text-white font-instrument-medium text-sm" numberOfLines={1}>
                            {lead.email ?? lead.name ?? lead.id}
                          </Text>
                          {(lead.name ?? lead.first_name) && (
                            <Text className="text-gray-400 text-xs mt-0.5" numberOfLines={1}>
                              {lead.first_name && lead.last_name ? `${lead.first_name} ${lead.last_name}` : (lead.name ?? lead.first_name ?? '')}
                            </Text>
                          )}
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedLeadId('sample');
                          setSelectedLead(null);
                        }}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          borderRadius: 10,
                          borderWidth: 1,
                          backgroundColor: selectedLeadId === 'sample' ? 'rgba(243,68,13,0.2)' : '#262626',
                          borderColor: selectedLeadId === 'sample' ? '#F3440D' : 'rgba(255,255,255,0.12)',
                        }}
                      >
                        <Text className="text-white font-instrument-medium text-sm">Sample</Text>
                        <Text className="text-gray-400 text-xs mt-0.5">Placeholder data</Text>
                      </TouchableOpacity>
                    </ScrollView>
                  )}
                </View>
                {(() => {
                  const resolvedLead: LeadLike =
                    selectedLeadId === 'sample' || !selectedLeadId
                      ? SAMPLE_LEAD
                      : (selectedLead?.id === selectedLeadId ? selectedLead : leads.find((l) => l.id === selectedLeadId)) != null
                        ? (selectedLead?.id === selectedLeadId ? selectedLead : leads.find((l) => l.id === selectedLeadId)) as LeadLike
                        : SAMPLE_LEAD;
                  const bodyText =
                    Platform.OS === 'web'
                      ? (bodyTextForPreview || (bodyEditorRef.current?.getText?.() ?? template))
                      : template;
                  const subjectSpun = processSpintax(subject, { deterministic: true });
                  const bodySpun = processSpintax(bodyText, { deterministic: true });
                  const mergedSubject = mergeTemplate(subjectSpun, resolvedLead);
                  const mergedBody = mergeTemplate(bodySpun, resolvedLead);
                  return (
                    <View
                      style={{
                        backgroundColor: '#141414',
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#2A2A2A',
                        padding: 16,
                      }}
                    >
                      <Text className="text-xs font-instrument-medium text-gray-400 mb-1">Subject</Text>
                      <Text className="text-white text-sm mb-4" numberOfLines={2}>
                        {mergedSubject || '(empty)'}
                      </Text>
                      <Text className="text-xs font-instrument-medium text-gray-400 mb-1">Body</Text>
                      <ScrollView
                        style={{ maxHeight: 200 }}
                        showsVerticalScrollIndicator
                        nestedScrollEnabled
                      >
                        <Text className="text-gray-300 text-sm whitespace-pre-wrap">
                          {mergedBody || '(empty)'}
                        </Text>
                      </ScrollView>
                    </View>
                  );
                })()}
              </>
            )}
          </View>
        )}
      </View>
    </BaseModal>
  );
}

export { EmailNodeModal };
export default EmailNodeModal;

