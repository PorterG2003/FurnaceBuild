import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback/Alert';
import { Select } from '@/components/ui/forms';
import { CodeBracketIcon, EyeIcon, ExclamationTriangleIcon } from 'react-native-heroicons/outline';
import { EmailBodyEditor } from '../EmailBodyEditor';
import { EmailPreviewModal } from './EmailPreviewModal';
import { getLeadVariables, extractVariableKeys, extractMalformedVariables, type LeadVariable } from '@/lib/email/index';
import { getLeadCount } from '@/lib/supabase/services/leads';

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

  const [previewOpen, setPreviewOpen] = useState(false);
  /** Snapshot of config when opening preview (subject, bodyHtml, bodyText, template). */
  const [previewConfig, setPreviewConfig] = useState<{
    subject: string;
    body_html?: string;
    body_text?: string;
    template: string;
  } | null>(null);

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
    }
  }, [visible, initialData]);

  const leadVariables = useMemo(
    () =>
      getLeadVariables(
        initialData?.mappedStandardFieldKeys,
        initialData?.customFieldKeys
      ),
    [initialData?.mappedStandardFieldKeys, initialData?.customFieldKeys]
  );

  const variableKeys = useMemo(
    () => extractVariableKeys(subject, template),
    [subject, template]
  );

  const validKeys = useMemo(
    () => new Set(leadVariables.map((v) => v.token.replace(/^\{\{|\}\}$/g, ''))),
    [leadVariables]
  );

  const unknownKeys = useMemo(
    () => variableKeys.filter((k) => !validKeys.has(k)),
    [variableKeys, validKeys]
  );

  const malformedVars = useMemo(
    () => extractMalformedVariables(subject, template),
    [subject, template]
  );

  const hasInvalidVars = unknownKeys.length > 0 || malformedVars.length > 0;

  const [missingValueCount, setMissingValueCount] = useState<number | null>(null);
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only run the count query for variable keys that actually exist in the schema
  const knownVariableKeys = useMemo(
    () => variableKeys.filter((k) => validKeys.has(k)),
    [variableKeys, validKeys]
  );

  useEffect(() => {
    if (countTimerRef.current) clearTimeout(countTimerRef.current);

    if (!visible || !initialData?.campaignId || knownVariableKeys.length === 0) {
      setMissingValueCount(null);
      return;
    }
    let cancelled = false;
    countTimerRef.current = setTimeout(() => {
      getLeadCount({ campaignId: initialData.campaignId, missingFields: knownVariableKeys })
        .then((count) => { if (!cancelled) setMissingValueCount(count); })
        .catch(() => { if (!cancelled) setMissingValueCount(null); });
    }, 500);
    return () => {
      cancelled = true;
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
    };
  }, [visible, initialData?.campaignId, knownVariableKeys]);

  const showMissingWarning = knownVariableKeys.length > 0 && missingValueCount != null && missingValueCount > 0;

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
        <Button variant="secondary" onPress={onClose} className="flex-1">
          Cancel
        </Button>
      </View>
      <View className="flex-1">
        <Button onPress={handleSave}>
          Save
        </Button>
      </View>
    </View>
  );

  const handleOpenPreview = () => {
    const bodyHtml = bodyEditorRef.current?.getHTML?.();
    const bodyText = bodyEditorRef.current?.getText?.();
    setPreviewConfig({
      subject,
      body_html: bodyHtml ?? undefined,
      body_text: bodyText ?? undefined,
      template: bodyText ?? template,
    });
    setPreviewOpen(true);
  };

  return (
    <>
    <BaseModal
      visible={visible}
      onClose={onClose}
      title="Configure Email Node"
      description="Personalize cold outreach emails using lead data from the connected bucket."
      footer={footer}
      maxWidth="full"
      height={typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.9) : 900}
    >
      <View className="gap-5">
        {hasInvalidVars && (
          <Alert
            variant="error"
            message={`The following variables are invalid or don't exist: ${[...unknownKeys.map((k) => `{{${k}}}`), ...malformedVars].join(', ')}. Check spelling or use the Variables menu.`}
          />
        )}
        {showMissingWarning && (
          <Alert
            variant="warning"
            message="Some leads may have empty values for the variables you're using. Preview to see which leads have missing data."
            actionText="Preview"
            onAction={handleOpenPreview}
          />
        )}
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
            onContentChange={(text) => setTemplate(text)}
            trailingElement={
              <TouchableOpacity
                onPress={handleOpenPreview}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor: hasInvalidVars
                    ? 'rgba(239,68,68,0.4)'
                    : showMissingWarning
                      ? 'rgba(245,158,11,0.4)'
                      : 'rgba(255,255,255,0.16)',
                  backgroundColor: hasInvalidVars
                    ? 'rgba(239,68,68,0.2)'
                    : showMissingWarning
                      ? 'rgba(245,158,11,0.2)'
                      : 'rgba(255,255,255,0.08)',
                }}
                activeOpacity={0.7}
              >
                {hasInvalidVars ? (
                  <ExclamationTriangleIcon size={18} color="#EF4444" />
                ) : showMissingWarning ? (
                  <ExclamationTriangleIcon size={18} color="#F59E0B" />
                ) : (
                  <EyeIcon size={18} color="#FFFFFF" />
                )}
                <Text
                  className="text-sm font-instrument-medium"
                  style={{ color: hasInvalidVars ? '#EF4444' : showMissingWarning ? '#F59E0B' : '#FFFFFF' }}
                >
                  Preview
                </Text>
              </TouchableOpacity>
            }
          />
        ) : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 }}>
              <TouchableOpacity
                onPress={handleOpenPreview}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderWidth: 1,
                  borderColor: hasInvalidVars
                    ? 'rgba(239,68,68,0.4)'
                    : showMissingWarning
                      ? 'rgba(245,158,11,0.4)'
                      : 'rgba(255,255,255,0.16)',
                  backgroundColor: hasInvalidVars
                    ? 'rgba(239,68,68,0.2)'
                    : showMissingWarning
                      ? 'rgba(245,158,11,0.2)'
                      : 'rgba(255,255,255,0.08)',
                }}
                activeOpacity={0.7}
              >
                {hasInvalidVars ? (
                  <ExclamationTriangleIcon size={18} color="#EF4444" />
                ) : showMissingWarning ? (
                  <ExclamationTriangleIcon size={18} color="#F59E0B" />
                ) : (
                  <EyeIcon size={18} color="#FFFFFF" />
                )}
                <Text
                  className="text-sm font-instrument-medium"
                  style={{ color: hasInvalidVars ? '#EF4444' : showMissingWarning ? '#F59E0B' : '#FFFFFF' }}
                >
                  Preview
                </Text>
              </TouchableOpacity>
            </View>
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
          </>
        )}
      </View>
    </BaseModal>

    <EmailPreviewModal
      visible={previewOpen}
      onClose={() => setPreviewOpen(false)}
      config={previewConfig}
      campaignId={initialData?.campaignId}
      variableKeys={variableKeys}
    />
    </>
  );
}

export { EmailNodeModal };
export default EmailNodeModal;

