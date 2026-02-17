import { useMemo, useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import { CodeBracketIcon, EyeIcon } from 'react-native-heroicons/outline';
import { EmailBodyEditor } from '../EmailBodyEditor';
import { EmailPreviewModal } from './EmailPreviewModal';
import { getLeadVariables, type LeadVariable } from '@/lib/email';

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
                  borderColor: 'rgba(255,255,255,0.16)',
                  backgroundColor: 'rgba(255,255,255,0.08)',
                }}
                activeOpacity={0.7}
              >
                <EyeIcon size={18} color="#FFFFFF" />
                <Text className="text-sm font-instrument-medium text-white">Preview</Text>
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
                  borderColor: 'rgba(255,255,255,0.16)',
                  backgroundColor: 'rgba(255,255,255,0.08)',
                }}
                activeOpacity={0.7}
              >
                <EyeIcon size={18} color="#FFFFFF" />
                <Text className="text-sm font-instrument-medium text-white">Preview</Text>
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
    />
    </>
  );
}

export { EmailNodeModal };
export default EmailNodeModal;

