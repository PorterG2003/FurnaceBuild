import { useMemo, useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { CodeBracketIcon } from 'react-native-heroicons/outline';
import { BaseModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { EmailBodyEditor } from '../EmailBodyEditor';

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
      maxWidth="2xl"
      maxHeight={720}
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
      </View>
    </BaseModal>
  );
}

export { EmailNodeModal };
export default EmailNodeModal;

