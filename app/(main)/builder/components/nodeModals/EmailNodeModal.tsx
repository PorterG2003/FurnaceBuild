import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, Platform, ScrollView, type ViewStyle } from 'react-native';
import { BaseModal, ConfirmModal, ModalFooter } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback/Alert';
import { MergeTagVariablePicker } from '@/components/builder/MergeTagVariablePicker';
import { useConfirmClose } from '@/hooks/useConfirmClose';
import {
  EyeIcon,
  EyeSlashIcon,
  PlusIcon,
  TrashIcon,
} from 'react-native-heroicons/outline';
import { EmailBodyEditor } from '../EmailBodyEditor';
import { EmailPreviewModal } from './EmailPreviewModal';
import { EmailHtmlCodeEditor } from '@/components/email/EmailHtmlCodeEditor';
import {
  canonicalizeEmailContentForSave,
  convertHtmlToRichTextSeed,
  extractVariableKeys,
  extractMalformedVariables,
  getLeadVariables,
  seedHtmlModeFromRichText,
  type EmailEditorMode,
  type LeadVariable,
} from '@/lib/email/index';
import { getLeadCount } from '@/lib/supabase/services/leads';
import {
  type EmailNodeVariant,
  generateEmailVariantId,
  labelForVariantIndex,
  normalizeLegacyEmailNodeData,
  sortVariantsForRoundRobin,
} from '@/lib/email/emailNodeVariants';

const MAX_VARIANTS = 20;

interface VariableInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  minHeight?: number;
  marginBottom?: number;
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
  marginBottom = 24,
  variant = 'body',
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
  };

  return (
    <View style={{ marginBottom }}>
      <Text className="text-sm font-instrument-medium mb-2 text-gray-300">{label}</Text>
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
          <MergeTagVariablePicker
            variables={variables}
            onSelect={handleSelectVariable}
          />
        </View>
      </View>
    </View>
  );
};

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

function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}

const BODY_PREVIEW_MAX = 80;

function stripHtmlForPreview(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain-text snippet for variant rail (template, body_text, or stripped body_html). */
function variantBodyPreview(v: EmailNodeVariant): string {
  const raw =
    (v.body_text && v.body_text.trim()) ||
    (v.body_html ? stripHtmlForPreview(v.body_html) : '') ||
    (v.template && v.template.trim()) ||
    '';
  const oneLine = raw.replace(/\r?\n/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > BODY_PREVIEW_MAX ? `${oneLine.slice(0, BODY_PREVIEW_MAX)}…` : oneLine;
}

type RailPressableState = { pressed: boolean; hovered?: boolean };

function variantRailIconStyle(
  disabled: boolean,
  kind: 'neutral' | 'danger',
  state: RailPressableState
): ViewStyle {
  const hovered = !!state.hovered;
  const pressed = state.pressed;
  const active = !disabled && (pressed || (Platform.OS === 'web' && hovered));
  const bg = disabled
    ? 'transparent'
    : active
      ? kind === 'danger'
        ? 'rgba(248,113,113,0.18)'
        : 'rgba(255,255,255,0.12)'
      : 'transparent';
  const scale = active ? 1.08 : 1;
  const web: ViewStyle =
    Platform.OS === 'web'
      ? ({ cursor: disabled ? 'default' : 'pointer' } as ViewStyle)
      : {};
  return {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    opacity: disabled ? 0.35 : 1,
    backgroundColor: bg,
    transform: [{ scale }],
    ...web,
  };
}

function addVariantCardStyle(disabled: boolean, state: RailPressableState): ViewStyle {
  const hovered = !!state.hovered;
  const pressed = state.pressed;
  const active = !disabled && (pressed || (Platform.OS === 'web' && hovered));
  const web: ViewStyle =
    Platform.OS === 'web'
      ? ({ cursor: disabled ? 'default' : 'pointer' } as ViewStyle)
      : {};
  return {
    borderRadius: 8,
    marginTop: 2,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: active ? 'rgba(255,255,255,0.22)' : '#2A2A2A',
    backgroundColor: active ? 'rgba(255,255,255,0.06)' : '#1A1A1A',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    opacity: disabled ? 0.4 : 1,
    transform: [{ scale: active ? 1.02 : 1 }],
    ...web,
  };
}

export interface EmailNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  initialData?: {
    label?: string;
    subject?: string;
    template?: string;
    body_html?: string;
    body_text?: string;
    mailboxId?: string;
    variants?: EmailNodeVariant[];
    campaignId?: string;
    customFieldKeys?: string[];
    mappedStandardFieldKeys?: string[];
    /** Campaign lifecycle: draft = pre-start */
    campaignStatus?: 'draft' | 'scheduled' | 'running' | 'paused' | 'stopped';
  };
}

type EmailNodeDraftSnapshot = {
  label: string;
  variants: EmailNodeVariant[];
};

function emailNodeDraftEquals(a: EmailNodeDraftSnapshot, b: EmailNodeDraftSnapshot): boolean {
  if (a.label !== b.label) return false;
  const sortedA = sortVariantsForRoundRobin(a.variants);
  const sortedB = sortVariantsForRoundRobin(b.variants);
  if (sortedA.length !== sortedB.length) return false;
  return sortedA.every((variant, index) => {
    const other = sortedB[index];
    return (
      variant.id === other.id &&
      variant.subject === other.subject &&
      variant.template === other.template &&
      (variant.body_html ?? '') === (other.body_html ?? '') &&
      (variant.body_text ?? '') === (other.body_text ?? '') &&
      (variant.editor_mode ?? 'richText') === (other.editor_mode ?? 'richText') &&
      variant.isActive === other.isActive &&
      variant.order === other.order
    );
  });
}

function EmailNodeModal({ visible, onClose, onSave, initialData }: EmailNodeModalProps) {
  const isPostStart =
    initialData?.campaignStatus != null &&
    initialData.campaignStatus !== 'draft' &&
    initialData.campaignStatus !== 'scheduled';

  const [label, setLabel] = useState(initialData?.label || 'Send Email');
  const [variants, setVariants] = useState<EmailNodeVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const bodyEditorRef = useRef<{ getHTML: () => string; getText: () => string } | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [switchToRichConfirmOpen, setSwitchToRichConfirmOpen] = useState(false);
  const [previewConfig, setPreviewConfig] = useState<{
    subject: string;
    body_html?: string;
    body_text?: string;
    template: string;
    editor_mode?: EmailEditorMode;
    variantId?: string;
  } | null>(null);
  const initialDraftRef = useRef<EmailNodeDraftSnapshot | null>(null);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === selectedVariantId) ?? variants[0],
    [variants, selectedVariantId]
  );

  const subject = selectedVariant?.subject ?? '';
  const template = selectedVariant?.template ?? '';
  const selectedVariantMode: EmailEditorMode = selectedVariant?.editor_mode === 'html' ? 'html' : 'richText';

  const initialBodyContent = useMemo(() => {
    if (selectedVariant?.editor_mode === 'html') return '<p></p>';
    const html = selectedVariant?.body_html;
    const tmpl = selectedVariant?.template;
    if (html && isHtml(html)) return convertHtmlToRichTextSeed(html);
    if (tmpl) return templateToHtml(tmpl);
    return '<p></p>';
  }, [selectedVariant?.body_html, selectedVariant?.template, selectedVariant?.editor_mode, selectedVariantId]);

  useEffect(() => {
    if (!visible || !initialData) return;
    const nextLabel = initialData.label ?? 'Send Email';
    setLabel(nextLabel);
    const { variants: v, legacyFields } = normalizeLegacyEmailNodeData(
      initialData as Record<string, unknown>
    );
    const sorted = sortVariantsForRoundRobin(v);
    initialDraftRef.current = {
      label: nextLabel,
      variants: sorted.map((variant) => ({ ...variant })),
    };
    setVariants(sorted);
    setSelectedVariantId(sorted[0]?.id ?? null);
    if (legacyFields.mailboxId != null) {
      /* mailbox kept in save payload via variants merge */
    }
  }, [visible, initialData]);

  const getCurrentDraft = useCallback((): EmailNodeDraftSnapshot => {
    const bodyHtml = bodyEditorRef.current?.getHTML?.();
    const bodyText = bodyEditorRef.current?.getText?.();
    const mergedVariants = variants.map((variant) => {
      if (variant.id !== selectedVariantId) return variant;
      if (selectedVariantMode === 'html') return variant;
      return {
        ...variant,
        template: Platform.OS === 'web' ? (bodyText ?? variant.template) : variant.template,
        body_html: bodyHtml ?? variant.body_html,
        body_text: bodyText ?? variant.body_text,
      };
    });
    return {
      label,
      variants: mergedVariants,
    };
  }, [label, variants, selectedVariantId, selectedVariantMode]);

  const isDirty =
    initialDraftRef.current === null
      ? false
      : !emailNodeDraftEquals(getCurrentDraft(), initialDraftRef.current);

  const handleClose = useConfirmClose(isDirty, onClose);

  const leadVariables = useMemo(
    () =>
      getLeadVariables(initialData?.mappedStandardFieldKeys, initialData?.customFieldKeys),
    [initialData?.mappedStandardFieldKeys, initialData?.customFieldKeys]
  );

  const variableKeys = useMemo(
    () => extractVariableKeys(subject, template, selectedVariant?.body_html),
    [subject, template, selectedVariant?.body_html]
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
    () => extractMalformedVariables(subject, template, selectedVariant?.body_html),
    [subject, template, selectedVariant?.body_html]
  );

  const knownVariableKeys = useMemo(
    () => variableKeys.filter((k) => validKeys.has(k)),
    [variableKeys, validKeys]
  );

  const [missingValueCount, setMissingValueCount] = useState<number | null>(null);
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (countTimerRef.current) clearTimeout(countTimerRef.current);
    if (!visible || !initialData?.campaignId || knownVariableKeys.length === 0) {
      setMissingValueCount(null);
      return;
    }
    let cancelled = false;
    countTimerRef.current = setTimeout(() => {
      getLeadCount({ campaignId: initialData.campaignId!, missingFields: knownVariableKeys })
        .then((count) => {
          if (!cancelled) setMissingValueCount(count);
        })
        .catch(() => {
          if (!cancelled) setMissingValueCount(null);
        });
    }, 500);
    return () => {
      cancelled = true;
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
    };
  }, [visible, initialData?.campaignId, knownVariableKeys]);

  const showMissingWarning =
    knownVariableKeys.length > 0 && missingValueCount != null && missingValueCount > 0;

  const updateSelectedVariant = useCallback(
    (patch: Partial<EmailNodeVariant>) => {
      if (!selectedVariantId) return;
      setVariants((prev) =>
        prev.map((v) => (v.id === selectedVariantId ? { ...v, ...patch } : v))
      );
    },
    [selectedVariantId]
  );

  const handleAddVariant = () => {
    if (variants.length >= MAX_VARIANTS) return;
    const nextOrder = variants.length === 0 ? 0 : Math.max(...variants.map((v) => v.order)) + 1;
    const id = generateEmailVariantId();
    const newV: EmailNodeVariant = {
      id,
      label: labelForVariantIndex(variants.length),
      subject: '',
      template: '',
      isActive: true,
      order: nextOrder,
    };
    setVariants((prev) => sortVariantsForRoundRobin([...prev, newV]));
    setSelectedVariantId(id);
  };

  const handleDeleteVariant = (id: string) => {
    if (isPostStart) return;
    setVariants((prev) => {
      const next = prev.filter((v) => v.id !== id);
      if (next.length === 0) return prev;
      const deleted = prev.find((v) => v.id === id);
      let out = next;
      if (deleted?.isActive && next.every((v) => !v.isActive)) {
        out = next.map((v, i) => (i === 0 ? { ...v, isActive: true } : v));
      }
      const sorted = sortVariantsForRoundRobin(out);
      if (selectedVariantId === id) {
        setSelectedVariantId(sorted[0]?.id ?? null);
      }
      return sorted;
    });
  };

  const handleToggleActive = (id: string) => {
    setVariants((prev) => {
      const target = prev.find((v) => v.id === id);
      if (!target) return prev;
      if (target.isActive && prev.filter((v) => v.isActive).length <= 1) {
        return prev;
      }
      return sortVariantsForRoundRobin(
        prev.map((v) => (v.id === id ? { ...v, isActive: !v.isActive } : v))
      );
    });
  };

  const handleSave = () => {
    const active = variants.filter((v) => v.isActive);
    if (active.length === 0) {
      return;
    }
    const bodyHtml = bodyEditorRef.current?.getHTML?.();
    const bodyText = bodyEditorRef.current?.getText?.();
    const merged = variants.map((v) => {
      if (v.id !== selectedVariantId) return v;
      if (selectedVariantMode === 'html') {
        return v;
      }
      return {
        ...v,
        template: Platform.OS === 'web' ? (bodyText ?? v.template) : v.template,
        body_html: bodyHtml ?? v.body_html,
        body_text: bodyText ?? v.body_text,
      };
    });
    const normalized = merged.map((variant) => {
      const canonical = canonicalizeEmailContentForSave({
        editorMode: variant.editor_mode,
        bodyHtml: variant.body_html,
        bodyText: variant.body_text,
        template: variant.template,
      });
      return {
        ...variant,
        editor_mode: canonical.editorMode,
        body_html: canonical.bodyHtml,
        body_text: canonical.bodyText,
        template: canonical.template,
      };
    });
    const sorted = sortVariantsForRoundRobin(normalized);
    const withSystemLabels = sorted.map((v, i) => ({
      ...v,
      label: labelForVariantIndex(i),
    }));
    onSave({
      label,
      mailboxId: (initialData as { mailboxId?: string })?.mailboxId ?? '',
      variants: withSystemLabels,
    });
    onClose();
  };

  const handleOpenPreview = () => {
    const bodyHtml = bodyEditorRef.current?.getHTML?.();
    const bodyText = bodyEditorRef.current?.getText?.();
    const draftHtml = selectedVariantMode === 'html' ? (selectedVariant?.body_html ?? '') : (bodyHtml ?? selectedVariant?.body_html);
    const draftText = selectedVariantMode === 'html' ? (selectedVariant?.body_text ?? selectedVariant?.template ?? '') : (bodyText ?? selectedVariant?.body_text ?? selectedVariant?.template ?? '');
    setPreviewConfig({
      subject,
      body_html: draftHtml ?? undefined,
      body_text: draftText ?? undefined,
      template: draftText ?? template,
      editor_mode: selectedVariantMode,
      variantId: selectedVariant?.id,
    });
    setPreviewOpen(true);
  };

  const handleSwitchSelectedVariantToHtml = useCallback(() => {
    if (!selectedVariantId) return;
    const bodyHtml = bodyEditorRef.current?.getHTML?.() ?? selectedVariant?.body_html ?? '';
    const bodyText = bodyEditorRef.current?.getText?.() ?? selectedVariant?.body_text ?? selectedVariant?.template ?? '';
    updateSelectedVariant({
      editor_mode: 'html',
      body_html: seedHtmlModeFromRichText(bodyHtml),
      body_text: bodyText,
      template: bodyText,
    });
  }, [selectedVariantId, selectedVariant?.body_html, selectedVariant?.body_text, selectedVariant?.template, updateSelectedVariant]);

  const handleConfirmSwitchSelectedVariantToRich = useCallback(() => {
    if (!selectedVariant) return;
    const canonical = canonicalizeEmailContentForSave({
      editorMode: 'html',
      bodyHtml: selectedVariant.body_html ?? '',
      bodyText: selectedVariant.body_text ?? selectedVariant.template,
      template: selectedVariant.template,
    });
    updateSelectedVariant({
      editor_mode: 'richText',
      body_html: convertHtmlToRichTextSeed(canonical.bodyHtml),
      body_text: canonical.bodyText,
      template: canonical.template,
    });
    setSwitchToRichConfirmOpen(false);
  }, [selectedVariant, updateSelectedVariant]);

  const sortedVariantsUi = useMemo(() => sortVariantsForRoundRobin(variants), [variants]);
  const activeCount = useMemo(() => variants.filter((v) => v.isActive).length, [variants]);
  const addVariantDisabled = variants.length >= MAX_VARIANTS;

  const footer = (
    <ModalFooter>
      <Button variant="secondary" onPress={handleClose}>
        Cancel
      </Button>
      <Button onPress={handleSave}>
        Save
      </Button>
    </ModalFooter>
  );

  const footerMobile = (
    <ModalFooter>
      <Button onPress={handleSave}>Save</Button>
    </ModalFooter>
  );

  return (
    <>
      <BaseModal
        visible={visible}
        onClose={handleClose}
        title="Configure Email Node"
        description="A/B variants rotate per send. Edit one variant at a time."
        footer={footer}
        footerMobile={footerMobile}
        maxWidth="full"
        height={typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.9) : 900}
      >
        <View style={{ flex: 1, flexDirection: 'column', gap: 16, minHeight: 0 }}>
          <View style={{ flexShrink: 0 }}>
            <Text className="text-sm font-instrument-medium mb-2 text-gray-300">Node label</Text>
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
            />
          </View>

          <View
            style={{
              flex: 1,
              flexDirection: Platform.OS === 'web' ? 'row' : 'column',
              gap: 16,
              minHeight: 0,
            }}
          >
            <View
              style={{
                width: Platform.OS === 'web' ? 280 : undefined,
                alignSelf: Platform.OS === 'web' ? 'stretch' : undefined,
                flexShrink: 0,
                maxHeight: Platform.OS === 'web' ? undefined : 280,
              }}
            >
              <Text className="text-xs text-gray-500 mb-2 font-instrument">Variants</Text>

              <ScrollView
                style={{ flex: 1, minHeight: 0 }}
                contentContainerStyle={{ paddingBottom: 8 }}
                showsVerticalScrollIndicator={false}
              >
                {sortedVariantsUi.map((v, index) => {
                    const letter = labelForVariantIndex(index);
                    const subj = v.subject?.trim() ?? '';
                    const bodyPv = variantBodyPreview(v);
                    const toggleDisabled = v.isActive && activeCount <= 1;
                    const deleteDisabled = isPostStart || variants.length <= 1;
                    const isSelected = selectedVariantId === v.id;
                    return (
                      <View
                        key={v.id}
                        style={{
                          position: 'relative',
                          borderRadius: 8,
                          marginBottom: 6,
                          borderWidth: 1,
                          borderColor: isSelected ? '#F3440D' : '#2A2A2A',
                          backgroundColor: isSelected ? 'rgba(243,68,13,0.15)' : '#1A1A1A',
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            zIndex: 2,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 0,
                          }}
                          pointerEvents="box-none"
                        >
                          <Pressable
                            onPress={() => handleToggleActive(v.id)}
                            disabled={toggleDisabled}
                            accessibilityRole="button"
                            accessibilityLabel={v.isActive ? `Deactivate variant ${letter}` : `Activate variant ${letter}`}
                            accessibilityState={{ disabled: toggleDisabled }}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 2 }}
                            style={(s) => variantRailIconStyle(toggleDisabled, 'neutral', s as RailPressableState)}
                          >
                            {v.isActive ? (
                              <EyeSlashIcon size={15} color={toggleDisabled ? '#666' : '#FFFFFF'} />
                            ) : (
                              <EyeIcon size={15} color="#FFFFFF" />
                            )}
                          </Pressable>
                          <Pressable
                            onPress={() => handleDeleteVariant(v.id)}
                            disabled={deleteDisabled}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete variant ${letter}`}
                            accessibilityState={{ disabled: deleteDisabled }}
                            hitSlop={{ top: 6, bottom: 6, left: 2, right: 6 }}
                            style={(s) => variantRailIconStyle(deleteDisabled, 'danger', s as RailPressableState)}
                          >
                            <TrashIcon size={15} color={deleteDisabled ? '#666' : '#f87171'} />
                          </Pressable>
                        </View>

                        <TouchableOpacity
                          onPress={() => setSelectedVariantId(v.id)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`Select variant ${letter}`}
                          accessibilityState={{ selected: isSelected }}
                          style={{
                            paddingVertical: 12,
                            paddingLeft: 10,
                            paddingRight: 56,
                            minHeight: 44,
                          }}
                        >
                          <View className="flex-row items-center flex-wrap gap-2 mb-1 pr-1">
                            <Text className="text-white font-instrument-semibold text-sm">{letter}</Text>
                            {!v.isActive && (
                              <Text className="text-gray-500 text-xs font-instrument bg-[#2A2A2A] px-1.5 py-0.5 rounded">
                                Inactive
                              </Text>
                            )}
                          </View>
                          <Text
                            className="text-gray-300 font-instrument text-xs"
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {subj ? subj : '(No subject)'}
                          </Text>
                          <Text
                            className="text-gray-500 font-instrument text-xs mt-0.5"
                            numberOfLines={2}
                            ellipsizeMode="tail"
                          >
                            {bodyPv ? bodyPv : '—'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}

                <Pressable
                  onPress={handleAddVariant}
                  disabled={addVariantDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Add variant"
                  accessibilityState={{ disabled: addVariantDisabled }}
                  style={(s) => addVariantCardStyle(addVariantDisabled, s as RailPressableState)}
                >
                  <PlusIcon size={18} color={addVariantDisabled ? '#666' : '#FFFFFF'} />
                  <Text
                    className={`font-instrument-medium text-sm ${addVariantDisabled ? 'text-gray-500' : 'text-gray-200'}`}
                  >
                    Add variant
                  </Text>
                </Pressable>
              </ScrollView>
            </View>

            <View style={{ flex: 1, minWidth: 0 }} className="gap-4">
            {unknownKeys.length > 0 && (
              <Alert
                variant="warning"
                message={`Undeclared variables (will send blank): ${unknownKeys.map((k) => `{{${k}}}`).join(', ')}`}
              />
            )}
            {malformedVars.length > 0 && (
              <Alert
                variant="warning"
                message={`Malformed variables (will not merge): ${malformedVars.join(', ')}`}
              />
            )}
            {showMissingWarning && (
              <Alert
                variant="warning"
                message="Some leads may have empty values for the variables you're using."
                actionText="Preview"
                onAction={handleOpenPreview}
              />
            )}

            {selectedVariant && (
              <>
                <View style={{ marginBottom: 24 }}>
                  <VariableInput
                    label="Subject"
                    value={subject}
                    onChange={(s) => updateSelectedVariant({ subject: s })}
                    placeholder="e.g. Quick idea for {{first_name}} (or leave empty to continue thread)"
                    variant="subject"
                    marginBottom={4}
                    variables={leadVariables}
                  />
                  <Text className="text-xs text-gray-500">
                    Leave empty on follow-ups to keep the same thread.
                  </Text>
                </View>

                {selectedVariantMode === 'html' ? (
                  <EmailHtmlCodeEditor
                    value={selectedVariant?.body_html ?? ''}
                    onChangeText={(value) => updateSelectedVariant({ body_html: value })}
                    label="Email HTML"
                    placeholder="<table><tr><td>Hello {{first_name}}</td></tr></table>"
                    minHeight={260}
                    trailingElement={
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <TouchableOpacity onPress={handleOpenPreview} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
                          <EyeIcon size={18} color="#FFFFFF" />
                          <Text className="text-sm text-white">Preview</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setSwitchToRichConfirmOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
                          <Text className="text-sm text-white">Rich text</Text>
                        </TouchableOpacity>
                      </View>
                    }
                  />
                ) : Platform.OS === 'web' ? (
                  <EmailBodyEditor
                    key={`${selectedVariantId ?? 'none'}:${selectedVariantMode}`}
                    initialContent={initialBodyContent}
                    editorRef={bodyEditorRef}
                    variables={leadVariables}
                    placeholder="Hi {{first_name}},..."
                    minHeight={220}
                    label="Email Body"
                    onContentChange={(text) => updateSelectedVariant({ template: text })}
                    onHtmlChange={(html) => updateSelectedVariant({ body_html: html })}
                    onSwitchToHtml={handleSwitchSelectedVariantToHtml}
                    trailingElement={
                      <TouchableOpacity onPress={handleOpenPreview} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
                        <EyeIcon size={18} color="#FFFFFF" />
                        <Text className="text-sm text-white">Preview</Text>
                      </TouchableOpacity>
                    }
                  />
                ) : (
                  <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
                      <TouchableOpacity onPress={handleOpenPreview} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
                        <EyeIcon size={18} color="#FFFFFF" />
                        <Text className="text-sm text-white">Preview</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleSwitchSelectedVariantToHtml} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}>
                        <Text className="text-sm text-white">HTML</Text>
                      </TouchableOpacity>
                    </View>
                    <VariableInput
                      label="Email Body"
                      value={template}
                      onChange={(t) => updateSelectedVariant({ template: t })}
                      multiline
                      minHeight={220}
                      variant="body"
                      variables={leadVariables}
                    />
                  </View>
                )}
              </>
            )}
          </View>
          </View>
        </View>
      </BaseModal>

      <EmailPreviewModal
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        config={previewConfig}
        campaignId={initialData?.campaignId}
        variableKeys={variableKeys}
      />
      <ConfirmModal
        visible={switchToRichConfirmOpen}
        onClose={() => setSwitchToRichConfirmOpen(false)}
        onConfirm={handleConfirmSwitchSelectedVariantToRich}
        title="Switch back to Rich text?"
        message="Complex HTML may be simplified or replaced when converted back into the Rich text editor."
        confirmLabel="Switch"
      />
    </>
  );
}

export { EmailNodeModal };
export default EmailNodeModal;
