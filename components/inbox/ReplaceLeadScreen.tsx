import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/forms';
import { Alert, useToast } from '@/components/ui/feedback';
import { LAYOUT_BREAKPOINT } from '@/components/ui/layout';
import {
  replaceLeadWithNewContact,
  updateLeadProfileFields,
  type ReplaceLeadWithNewContactResult,
} from '@/lib/supabase/services/leads';
import type { Lead, ReplacementReason } from '@/lib/supabase/types';

const REPLACEMENT_REASON_OPTIONS: Array<{ id: ReplacementReason; name: string; description: string }> = [
  {
    id: 'manual_referral',
    name: 'Manual referral',
    description: 'The original contact suggested someone else to reach out to.',
  },
  {
    id: 'auto_reply_forward',
    name: 'Auto-reply forward',
    description: 'An automated reply named a better contact.',
  },
  {
    id: 'wrong_contact',
    name: 'Wrong contact',
    description: 'The original recipient was not the right person.',
  },
  {
    id: 'other',
    name: 'Other',
    description: 'Another replacement reason.',
  },
];

export interface ReplaceLeadScreenProps {
  oldLead: Lead | null;
  sourceMessageId?: string | null;
  onReplaced: (result: ReplaceLeadWithNewContactResult) => void;
  onCancel: () => void;
  layout?: 'modal' | 'page';
}

interface StandardFieldsState {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  companyName: string;
  website: string;
  linkedinUrl: string;
  companyLinkedinUrl: string;
}

const EMPTY_STANDARD_FIELDS: StandardFieldsState = {
  email: '',
  name: '',
  firstName: '',
  lastName: '',
  phoneNumber: '',
  companyName: '',
  website: '',
  linkedinUrl: '',
  companyLinkedinUrl: '',
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function formatCustomValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function readCustomLeadEntries(lead: Lead | null): Array<[string, unknown]> {
  const data = lead?.custom_lead_data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.entries(data as Record<string, unknown>);
}

function buildInitialCustomFields(lead: Lead | null): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of readCustomLeadEntries(lead)) {
    next[key] =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  }
  return next;
}

function seedStandardFields(lead: Lead | null): StandardFieldsState {
  if (!lead) return EMPTY_STANDARD_FIELDS;
  return {
    email: '',
    name: lead.name ?? '',
    firstName: lead.first_name ?? '',
    lastName: lead.last_name ?? '',
    phoneNumber: lead.phone_number ?? '',
    companyName: lead.company_name ?? '',
    website: lead.website ?? '',
    linkedinUrl: lead.linkedin_url ?? '',
    companyLinkedinUrl: lead.company_linkedin_url ?? '',
  };
}

function normalizeNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function ReplaceLeadScreen({
  oldLead,
  sourceMessageId,
  onReplaced,
  onCancel,
  layout = 'modal',
}: ReplaceLeadScreenProps) {
  const { toast } = useToast();
  const { width } = useWindowDimensions();
  const isNarrow = layout === 'page' || width < LAYOUT_BREAKPOINT;

  const [fields, setFields] = useState<StandardFieldsState>(EMPTY_STANDARD_FIELDS);
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<ReplacementReason>('manual_referral');
  const [reasonNote, setReasonNote] = useState('');
  const [saving, setSaving] = useState(false);

  const oldLeadId = oldLead?.id ?? null;

  useEffect(() => {
    if (!oldLead) return;
    setFields(seedStandardFields(oldLead));
    setCustomFields(buildInitialCustomFields(oldLead));
    setReason('manual_referral');
    setReasonNote('');
  }, [oldLeadId, oldLead]);

  const customEntries = useMemo(() => readCustomLeadEntries(oldLead), [oldLead]);

  const selectedReason = useMemo(
    () => REPLACEMENT_REASON_OPTIONS.find((option) => option.id === reason) ?? REPLACEMENT_REASON_OPTIONS[0],
    [reason]
  );

  const validationError = useMemo(() => {
    if (!fields.email.trim()) return 'Replacement email is required.';
    if (!isValidEmail(fields.email)) return 'Enter a valid email address.';
    const oldEmail = oldLead?.email;
    if (oldEmail && fields.email.trim().toLowerCase() === oldEmail.trim().toLowerCase()) {
      return 'Replacement email must differ from the current lead email.';
    }
    return null;
  }, [fields.email, oldLead?.email]);

  if (!oldLead) return null;

  const setField = <K extends keyof StandardFieldsState>(key: K, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const result = await replaceLeadWithNewContact({
        oldLeadId: oldLead.id,
        newEmail: fields.email,
        newName: normalizeNullable(fields.name),
        newFirstName: normalizeNullable(fields.firstName),
        newLastName: normalizeNullable(fields.lastName),
        newPhoneNumber: normalizeNullable(fields.phoneNumber),
        reason,
        reasonNote: reasonNote.trim() || null,
        sourceMessageId: sourceMessageId ?? null,
      });

      const profilePatch = buildProfilePatch(oldLead, fields, customFields, customEntries);
      let profileUpdateFailed = false;
      if (profilePatch) {
        try {
          await updateLeadProfileFields({ leadId: result.newLeadId, ...profilePatch });
        } catch (err) {
          profileUpdateFailed = true;
          toast.error(
            err instanceof Error
              ? `Replacement saved, but profile edits couldn't be applied: ${err.message}`
              : "Replacement saved, but profile edits couldn't be applied."
          );
        }
      }

      if (!profileUpdateFailed) {
        toast.success('Replacement lead created.');
      }
      onReplaced(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to replace lead.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="gap-5">
      {!isNarrow && (
        <View className="flex-row gap-4">
          <View className="flex-1">
            <ColumnHeader label="Current lead" subtitle={oldLead.email ?? 'No email on file'} />
          </View>
          <View className="flex-1">
            <ColumnHeader label="Replacement contact" subtitle="Pre-filled from current lead" />
          </View>
        </View>
      )}

      <View className="gap-3">
        <ComparisonRow
          label="Email"
          isNarrow={isNarrow}
          oldValue={oldLead.email}
          newValue={fields.email}
          onNewValueChange={(value) => setField('email', value)}
          placeholder="sarah@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          required
          highlightDifferent
        />
        <ComparisonRow
          label="Name"
          isNarrow={isNarrow}
          oldValue={oldLead.name}
          newValue={fields.name}
          onNewValueChange={(value) => setField('name', value)}
          placeholder="Sarah Johnson"
        />
        <ComparisonRow
          label="First name"
          isNarrow={isNarrow}
          oldValue={oldLead.first_name}
          newValue={fields.firstName}
          onNewValueChange={(value) => setField('firstName', value)}
          placeholder="Sarah"
        />
        <ComparisonRow
          label="Last name"
          isNarrow={isNarrow}
          oldValue={oldLead.last_name}
          newValue={fields.lastName}
          onNewValueChange={(value) => setField('lastName', value)}
          placeholder="Johnson"
        />
        <ComparisonRow
          label="Phone"
          isNarrow={isNarrow}
          oldValue={oldLead.phone_number}
          newValue={fields.phoneNumber}
          onNewValueChange={(value) => setField('phoneNumber', value)}
          placeholder="+1 555 123 4567"
          keyboardType="phone-pad"
        />
        <ComparisonRow
          label="Company"
          isNarrow={isNarrow}
          oldValue={oldLead.company_name}
          newValue={fields.companyName}
          onNewValueChange={(value) => setField('companyName', value)}
          placeholder="Acme Inc."
        />
        <ComparisonRow
          label="Website"
          isNarrow={isNarrow}
          oldValue={oldLead.website}
          newValue={fields.website}
          onNewValueChange={(value) => setField('website', value)}
          placeholder="https://acme.com"
          autoCapitalize="none"
        />
        <ComparisonRow
          label="LinkedIn"
          isNarrow={isNarrow}
          oldValue={oldLead.linkedin_url}
          newValue={fields.linkedinUrl}
          onNewValueChange={(value) => setField('linkedinUrl', value)}
          placeholder="https://linkedin.com/in/..."
          autoCapitalize="none"
        />
        <ComparisonRow
          label="Company LinkedIn"
          isNarrow={isNarrow}
          oldValue={oldLead.company_linkedin_url}
          newValue={fields.companyLinkedinUrl}
          onNewValueChange={(value) => setField('companyLinkedinUrl', value)}
          placeholder="https://linkedin.com/company/..."
          autoCapitalize="none"
        />
      </View>

      {customEntries.length > 0 && (
        <View className="gap-3 border-t border-[#2A2A2A] pt-4">
          <Text className="text-xs font-instrument-medium text-gray-300 uppercase tracking-wide">
            Custom fields
          </Text>
          <View className="gap-3">
            {customEntries.map(([key, value]) => (
              <ComparisonRow
                key={key}
                label={key}
                isNarrow={isNarrow}
                oldValue={formatCustomValue(value)}
                newValue={customFields[key] ?? ''}
                onNewValueChange={(next) => setCustomFields((prev) => ({ ...prev, [key]: next }))}
                placeholder=""
              />
            ))}
          </View>
        </View>
      )}

      <View className="gap-3 border-t border-[#2A2A2A] pt-4">
        <View>
          <Text className="text-xs font-instrument-medium text-gray-400 mb-1.5">Replacement reason</Text>
          <Select<{ id: ReplacementReason; name: string; description: string }>
            items={REPLACEMENT_REASON_OPTIONS}
            getItemId={(item) => item.id}
            getItemLabel={(item) => ({ primary: item.name, secondary: item.description })}
            value={reason}
            onChange={(id, item) => setReason((item?.id ?? id) as ReplacementReason)}
            placeholder="Select reason"
            searchable={false}
            noMargin
          />
          <Text className="text-xs font-instrument text-gray-500 mt-1.5">
            {selectedReason.description}
          </Text>
        </View>

        <View>
          <Text className="text-xs font-instrument-medium text-gray-400 mb-1.5">Context note</Text>
          <TextInput
            value={reasonNote}
            onChangeText={setReasonNote}
            placeholder="Optional context from the reply or your notes"
            placeholderTextColor="#6b7280"
            multiline
            textAlignVertical="top"
            className="text-white font-instrument text-sm px-3 py-3 rounded-xl border border-[#3A3A3A] bg-[#111111] min-h-[96px]"
            style={[
              { minHeight: 96 },
              Platform.OS === 'web' ? { scrollMarginBottom: 24 } : null,
            ]}
          />
        </View>
      </View>

      <Alert
        variant="info"
        message="The new lead becomes the active campaign contact. The existing enrollment and future pending work move to that new lead, while past sends and events stay attributed to the original lead for audit history. The outbound mailbox and source attribution carry over automatically."
        className="mb-0"
      />

      <View className="flex-row gap-2 flex-wrap">
        <Button
          variant="default"
          className="flex-1 min-w-[120px]"
          onPress={() => void handleSave()}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-instrument-medium">Replace lead</Text>
          )}
        </Button>
        <Button
          variant="secondary"
          className="flex-1 min-w-[120px]"
          onPress={onCancel}
          disabled={saving}
        >
          <Text className="text-gray-200 font-instrument-medium">Cancel</Text>
        </Button>
      </View>
    </View>
  );
}

interface ColumnHeaderProps {
  label: string;
  subtitle: string;
}

function ColumnHeader({ label, subtitle }: ColumnHeaderProps) {
  return (
    <View>
      <Text className="text-xs font-instrument-medium text-gray-300 uppercase tracking-wide">
        {label}
      </Text>
      <Text className="text-xs font-instrument text-gray-500 mt-0.5" numberOfLines={1}>
        {subtitle}
      </Text>
    </View>
  );
}

interface ComparisonRowProps {
  label: string;
  isNarrow: boolean;
  oldValue: string | null | undefined;
  newValue: string;
  onNewValueChange: (value: string) => void;
  placeholder: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  required?: boolean;
  highlightDifferent?: boolean;
}

function ComparisonRow({
  label,
  isNarrow,
  oldValue,
  newValue,
  onNewValueChange,
  placeholder,
  autoCapitalize,
  keyboardType,
  required,
  highlightDifferent,
}: ComparisonRowProps) {
  const oldDisplay = oldValue && String(oldValue).trim() !== '' ? String(oldValue) : '—';
  const hasOldValue = oldDisplay !== '—';
  const inputClassName =
    'text-white font-instrument text-sm px-3 py-2.5 rounded-xl border border-[#3A3A3A] bg-[#111111]';
  const inputScrollMarginWeb =
    Platform.OS === 'web' ? ({ scrollMarginBottom: 24 } as const) : undefined;
  const showDiffHint =
    highlightDifferent &&
    newValue.trim() !== '' &&
    newValue.trim().toLowerCase() === (oldValue ?? '').trim().toLowerCase();

  const labelText = (
    <Text className="text-xs font-instrument-medium text-gray-400 mb-1.5">
      {label}
      {required ? <Text className="text-red-400"> *</Text> : null}
      {isNarrow && hasOldValue ? (
        <Text className="font-instrument text-gray-500">{'  ·  was '}{oldDisplay}</Text>
      ) : null}
    </Text>
  );

  if (isNarrow) {
    return (
      <View>
        {labelText}
        <TextInput
          value={newValue}
          onChangeText={onNewValueChange}
          placeholder={placeholder}
          placeholderTextColor="#6b7280"
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          className={inputClassName}
          style={inputScrollMarginWeb}
        />
        {showDiffHint && (
          <Text className="text-[10px] font-instrument text-yellow-500 mt-1">
            Same as current lead — enter a different value.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View>
      {labelText}
      <View className="flex-row gap-4">
        <View className="flex-1">
          <View className="rounded-xl border border-[#2A2A2A] bg-[#0d0d0d] px-3 py-2.5">
            <Text className="text-gray-300 font-instrument text-sm break-all" selectable>
              {oldDisplay}
            </Text>
          </View>
        </View>
        <View className="flex-1">
          <TextInput
            value={newValue}
            onChangeText={onNewValueChange}
            placeholder={placeholder}
            placeholderTextColor="#6b7280"
            autoCapitalize={autoCapitalize}
            keyboardType={keyboardType}
            className={inputClassName}
            style={inputScrollMarginWeb}
          />
          {showDiffHint && (
            <Text className="text-[10px] font-instrument text-yellow-500 mt-1">
              Same as current lead — enter a different value.
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

interface ProfilePatch {
  companyName?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  companyLinkedinUrl?: string | null;
  customLeadData?: Record<string, unknown> | null;
}

function buildProfilePatch(
  oldLead: Lead,
  fields: StandardFieldsState,
  customFields: Record<string, string>,
  customEntries: Array<[string, unknown]>
): ProfilePatch | null {
  const patch: ProfilePatch = {};

  const newCompany = normalizeNullable(fields.companyName);
  if (newCompany !== (oldLead.company_name ?? null)) patch.companyName = newCompany;

  const newWebsite = normalizeNullable(fields.website);
  if (newWebsite !== (oldLead.website ?? null)) patch.website = newWebsite;

  const newLinkedin = normalizeNullable(fields.linkedinUrl);
  if (newLinkedin !== (oldLead.linkedin_url ?? null)) patch.linkedinUrl = newLinkedin;

  const newCompanyLinkedin = normalizeNullable(fields.companyLinkedinUrl);
  if (newCompanyLinkedin !== (oldLead.company_linkedin_url ?? null)) {
    patch.companyLinkedinUrl = newCompanyLinkedin;
  }

  if (customEntries.length > 0) {
    let customChanged = false;
    const merged: Record<string, unknown> = {};
    for (const [key, originalValue] of customEntries) {
      const editedStr = customFields[key] ?? '';
      const originalStr = formatCustomValue(originalValue);
      if (editedStr !== originalStr && !(originalStr === '—' && editedStr === '')) {
        merged[key] = editedStr;
        customChanged = true;
      } else {
        merged[key] = originalValue;
      }
    }
    if (customChanged) patch.customLeadData = merged;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
