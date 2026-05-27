import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { FormTextField } from '@/components/ui/forms/FormTextField';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import type { AccountLeadDetail, AccountPersonProfileUpdate } from '@/lib/leads/types';
import { updateAccountPersonProfile } from '@/lib/supabase/services/leads/lead-detail';
import {
  LeadDetailDivider,
  LeadDetailSection,
  LeadDetailSubsection,
  useLeadDetailLayout,
} from './leadDetailLayout';
import { useLeadDetailMobilePage } from './mobile/LeadDetailMobilePageContext';

function mergeCustomFields(detail: AccountLeadDetail): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const membership of detail.person.memberships) {
    for (const [key, value] of Object.entries(membership.customLeadData)) {
      if (value != null && merged[key] === undefined) {
        merged[key] = String(value);
      }
    }
  }
  return merged;
}

function pickProfileFields(detail: AccountLeadDetail) {
  const newest = [...detail.person.memberships].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    name: detail.person.displayName ?? '',
    first_name: detail.person.firstName ?? '',
    last_name: detail.person.lastName ?? '',
    company_name: newest?.companyName ?? '',
    website: newest?.website ?? '',
    linkedin_url: newest?.linkedinUrl ?? '',
    phone_number: newest?.phone ?? '',
  };
}

export function LeadProfileSection({
  accountId,
  detail,
  onSaved,
}: {
  accountId: string;
  detail: AccountLeadDetail;
  onSaved: () => void;
}) {
  const { isMobile } = useLeadDetailLayout();
  const { suppressSectionHeader: isMobileDrill } = useLeadDetailMobilePage();
  const initial = useMemo(() => pickProfileFields(detail), [detail]);
  const initialCustom = useMemo(() => mergeCustomFields(detail), [detail]);

  const [name, setName] = useState(initial.name);
  const [firstName, setFirstName] = useState(initial.first_name);
  const [lastName, setLastName] = useState(initial.last_name);
  const [companyName, setCompanyName] = useState(initial.company_name);
  const [website, setWebsite] = useState(initial.website);
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedin_url);
  const [phoneNumber, setPhoneNumber] = useState(initial.phone_number);
  const [customFields, setCustomFields] = useState<Record<string, string>>(initialCustom);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(initial.name);
    setFirstName(initial.first_name);
    setLastName(initial.last_name);
    setCompanyName(initial.company_name);
    setWebsite(initial.website);
    setLinkedinUrl(initial.linkedin_url);
    setPhoneNumber(initial.phone_number);
    setCustomFields(initialCustom);
  }, [initial, initialCustom]);

  const hasMultipleMemberships = detail.person.memberships.length > 1;

  const handleCancel = useCallback(() => {
    setName(initial.name);
    setFirstName(initial.first_name);
    setLastName(initial.last_name);
    setCompanyName(initial.company_name);
    setWebsite(initial.website);
    setLinkedinUrl(initial.linkedin_url);
    setPhoneNumber(initial.phone_number);
    setCustomFields(initialCustom);
    setError(null);
  }, [initial, initialCustom]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (!trimmedName && !trimmedFirst && !trimmedLast) {
      setError('Enter a name or first and last name.');
      return;
    }

    const updates: AccountPersonProfileUpdate = {
      name: trimmedName || null,
      first_name: trimmedFirst || null,
      last_name: trimmedLast || null,
      company_name: companyName.trim() || null,
      website: website.trim() || null,
      linkedin_url: linkedinUrl.trim() || null,
      phone_number: phoneNumber.trim() || null,
      custom_lead_data: Object.keys(customFields).length
        ? Object.fromEntries(
            Object.entries(customFields).map(([key, value]) => [key, value.trim() || null]),
          )
        : null,
    };

    try {
      setSaving(true);
      setError(null);
      await updateAccountPersonProfile(accountId, detail.person.globalLeadId, updates);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }, [
    accountId,
    companyName,
    customFields,
    detail.person.globalLeadId,
    firstName,
    lastName,
    linkedinUrl,
    name,
    onSaved,
    phoneNumber,
    website,
  ]);

  const footer = (
    <View className="flex-row gap-3 justify-end">
      <Button variant="secondary" size="sm" onPress={handleCancel} disabled={saving}>
        Cancel
      </Button>
      <Button variant="default" size="sm" onPress={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save changes'}
      </Button>
    </View>
  );

  return (
    <LeadDetailSection
      title="Profile"
      description={isMobileDrill ? undefined : 'Contact details shared across every campaign this person belongs to.'}
      footer={footer}
    >
      {hasMultipleMemberships ? (
        <Alert
          variant="info"
          message="This person appears in multiple campaigns. Profile edits apply to all campaign copies."
        />
      ) : null}

      {error ? <Alert variant="error" message={error} /> : null}

      <LeadDetailSubsection title="Identity">
        <FormTextField label="Email" value={detail.person.email} editable={false} />
        {!isMobileDrill ? (
          <Text className="text-xs text-gray-500 font-instrument -mt-2 leading-4">
            Email is the lead identity. Use Replace Lead in inbox to change the contact email.
          </Text>
        ) : null}
        <FormTextField label="Display name" value={name} onChangeText={setName} />
        <View className={isMobile ? 'gap-4' : 'flex-row gap-4'}>
          <View className="flex-1">
            <FormTextField label="First name" value={firstName} onChangeText={setFirstName} />
          </View>
          <View className="flex-1">
            <FormTextField label="Last name" value={lastName} onChangeText={setLastName} />
          </View>
        </View>
      </LeadDetailSubsection>

      {!isMobileDrill ? <LeadDetailDivider /> : null}

      <LeadDetailSubsection title="Company & contact">
        <FormTextField label="Company" value={companyName} onChangeText={setCompanyName} />
        <FormTextField label="Phone" value={phoneNumber} onChangeText={setPhoneNumber} />
        <FormTextField label="Website" value={website} onChangeText={setWebsite} autoCapitalize="none" />
        <FormTextField label="LinkedIn URL" value={linkedinUrl} onChangeText={setLinkedinUrl} autoCapitalize="none" />
      </LeadDetailSubsection>

      {Object.keys(customFields).length > 0 ? (
        <>
          {!isMobileDrill ? <LeadDetailDivider /> : null}
          <LeadDetailSubsection title="Custom fields">
            {Object.entries(customFields).map(([key, value]) => (
              <FormTextField
                key={key}
                label={key}
                value={value}
                onChangeText={(next) => setCustomFields((current) => ({ ...current, [key]: next }))}
              />
            ))}
          </LeadDetailSubsection>
        </>
      ) : null}
    </LeadDetailSection>
  );
}
