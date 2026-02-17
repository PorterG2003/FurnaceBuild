import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import { CodeBracketIcon } from 'react-native-heroicons/outline';
import { EmailBodyEditor } from '../EmailBodyEditor';
import { getLeads } from '@/lib/supabase/services/leads';
import { mergeTemplate, processSpintax, getLeadVariables, type LeadLike, type LeadVariable } from '@/lib/email';
import type { Lead } from '@/lib/supabase/types';
import { debounce } from '@/lib/utils/debounce';

interface VariableInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  minHeight?: number;
  variant?: 'subject' | 'body';
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
  variables,
}: VariableInputProps) => {
  const [variableSearch, setVariableSearch] = useState('');

  const filteredVariables = useMemo(() => {
    if (!variableSearch.trim()) return variables;
    const q = variableSearch.trim().toLowerCase();
    return variables.filter(
      (v) =>
        v.token.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)
    );
  }, [variables, variableSearch]);

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
  };

  return (
    <View style={{ marginBottom: 24 }}>
      <Text className="text-sm font-instrument-medium mb-2 text-gray-300">
        {label}
      </Text>
      <View style={{ position: 'relative' }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor="#666"
          className="border border-white/30 rounded-xl px-4 py-3 bg-white/5 text-base text-white"
          style={{
            borderColor: '#FFFFFF4D',
            backgroundColor: '#FFFFFF0D',
            color: '#FFFFFF',
            borderWidth: 1,
            paddingRight: 52,
            textAlignVertical: multiline ? 'top' : 'center',
            ...(multiline && typeof minHeight === 'number' ? { minHeight } : {}),
          }}
          selectionColor="#FF4D00"
          underlineColorAndroid="transparent"
          multiline={multiline}
        />
        <View style={{ position: 'absolute', top: 7, right: 7 }}>
          <Select<LeadVariable>
            items={filteredVariables}
            getItemId={(v) => v.token}
            getItemLabel={(v) => ({ primary: v.token, secondary: v.description })}
            value={null}
            onChange={(_id, item) => {
              if (item) handleSelectVariable(item.token);
            }}
            searchable={true}
            onSearchChange={setVariableSearch}
            searchValue={variableSearch}
            placeholder="Variables"
            searchPlaceholder="Search variables…"
            emptyMessage={(hasSearch) =>
              hasSearch ? 'No matching variables.' : 'No variables.'
            }
            listMaxHeight={320}
            noMargin={true}
            size="compact"
            dropdownMinWidth={260}
            renderTrigger={({ open, onPress }) => (
              <TouchableOpacity
                onPress={onPress}
                style={{
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor: open ? 'rgba(243,68,13,0.4)' : 'rgba(255,255,255,0.16)',
                  backgroundColor: open ? 'rgba(243,68,13,0.2)' : 'rgba(255,255,255,0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CodeBracketIcon size={18} color={open ? '#F3440D' : '#FFFFFF'} />
              </TouchableOpacity>
            )}
          />
        </View>
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
    customFieldKeys?: string[];
    mappedStandardFieldKeys?: string[];
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
  const bodyEditorRef = useRef<{ getHTML: () => string; getText: () => string } | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
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
          const nextId: string | null = data.length > 0 ? data[0].id : null;
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
    () =>
      getLeadVariables(
        initialData?.mappedStandardFieldKeys,
        initialData?.customFieldKeys
      ),
    [initialData?.mappedStandardFieldKeys, initialData?.customFieldKeys]
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
            variables={leadVariables}
          />
        )}

        {initialData?.campaignId && (
          <View className="pt-4 border-t border-[#2A2A2A]">
            <Text className="text-sm font-instrument-medium mb-3 text-gray-300">
              Preview message
            </Text>
            <Select<Lead>
              items={leads}
              getItemId={(l) => l.id}
              getItemLabel={(l) => ({
                primary: l.email ?? l.name ?? l.id,
                secondary: (l.first_name && l.last_name ? `${l.first_name} ${l.last_name}` : (l.name ?? l.first_name ?? '')) || undefined,
              })}
              value={selectedLeadId}
              onChange={(id, item) => {
                setSelectedLeadId(id);
                setSelectedLead(item);
              }}
              onSearchChange={setLeadSearch}
              searchValue={leadSearch}
              loading={leadsLoading}
              label="Select lead"
              placeholder="Select lead…"
              searchPlaceholder="Search by email or name…"
              emptyMessage={(hasSearch) =>
                hasSearch
                  ? 'No leads match your search.'
                  : 'No leads in this campaign — add leads to preview with real data. Showing sample below.'
              }
              loadingMessage="Loading leads…"
            />
            {(() => {
                  const resolvedLead: LeadLike =
                    !selectedLeadId
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
          </View>
        )}
      </View>
    </BaseModal>
  );
}

export { EmailNodeModal };
export default EmailNodeModal;

