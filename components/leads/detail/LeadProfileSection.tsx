import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { FormTextField } from '@/components/ui/forms/FormTextField';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import type { AccountLeadDetail, AccountPersonProfileUpdate } from '@/lib/leads/types';
import { updateAccountPersonProfile } from '@/lib/supabase/services/leads/lead-detail';
import { getCreditBalance, type CreditBalance } from '@/lib/credits/balance';
import { CREDIT_METERS } from '@/lib/credits/meters';
import type { LeadDetailFrom, OpenLeadDetailParams } from '@/lib/leads/navigation';
import { buildEnrichLeadPath } from '@/lib/leads/navigation';
import { getLatestEnrichmentSession } from '@/lib/apollo/getPendingEnrichmentSession';
import { isPendingEnrichmentSession } from '@/lib/apollo/enrichmentSessionTypes';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import {
  LeadDetailDivider,
  LeadDetailSection,
  LeadDetailSubsection,
  useLeadDetailLayout,
} from './leadDetailLayout';
import { useLeadDetailMobilePage } from './mobile/LeadDetailMobilePageContext';
import { ENRICH_COPY } from './enrichCopy';
import { EnrichCreditBalancePill } from './EnrichLeadMeta';

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
    mobile_phone_number: newest?.mobilePhone ?? '',
  };
}

export function LeadProfileSection({
  accountId,
  detail,
  onSaved,
  onOpenEnrich,
  enrichmentStatusRefreshKey,
}: {
  accountId: string;
  detail: AccountLeadDetail;
  onSaved: () => void;
  onOpenEnrich?: () => void;
  /** Bump when the enrich panel closes so credits / pending state refresh. */
  enrichmentStatusRefreshKey?: number;
}) {
  const { isMobile } = useLeadDetailLayout();
  const { suppressSectionHeader: isMobileDrill } = useLeadDetailMobilePage();
  const router = useRouter();
  const initial = useMemo(() => pickProfileFields(detail), [detail]);
  const initialCustom = useMemo(() => mergeCustomFields(detail), [detail]);

  const globalLeadId = detail.person.globalLeadId;
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);
  const [hasCachedEnrichment, setHasCachedEnrichment] = useState(false);
  const [phonePending, setPhonePending] = useState(false);

  const hasMatchKey = useMemo(() => {
    if (detail.person.email && detail.person.email.trim() !== '') return true;
    return detail.person.memberships.some((m) => m.linkedinUrl && m.linkedinUrl.trim() !== '');
  }, [detail.person.email, detail.person.memberships]);

  const refreshEnrichmentStatus = useCallback(async () => {
    if (!accountId || !globalLeadId) return;
    try {
      const [balance, session] = await Promise.all([
        getCreditBalance(accountId, CREDIT_METERS.apolloEnrichment),
        getLatestEnrichmentSession(accountId, globalLeadId),
      ]);
      setCreditBalance(balance);
      setHasCachedEnrichment(session != null);
      setPhonePending(session != null && isPendingEnrichmentSession(session));
    } catch {
      // Non-blocking: leave the caption hidden if the balance can't be read.
    }
  }, [accountId, globalLeadId]);

  useEffect(() => {
    void refreshEnrichmentStatus();
  }, [refreshEnrichmentStatus, enrichmentStatusRefreshKey]);

  useFocusEffect(
    useCallback(() => {
      void refreshEnrichmentStatus();
    }, [refreshEnrichmentStatus]),
  );

  const routeParams = useLocalSearchParams<{
    from?: LeadDetailFrom;
    campaignId?: string;
    listId?: string;
    listName?: string;
    campaignName?: string;
    threadId?: string;
  }>();

  const enrichNavigationContext = useMemo<OpenLeadDetailParams>(
    () => ({
      from: typeof routeParams.from === 'string' ? routeParams.from : undefined,
      campaignId: typeof routeParams.campaignId === 'string' ? routeParams.campaignId : undefined,
      listId: typeof routeParams.listId === 'string' ? routeParams.listId : undefined,
      listName: typeof routeParams.listName === 'string' ? routeParams.listName : undefined,
      campaignName:
        typeof routeParams.campaignName === 'string' ? routeParams.campaignName : undefined,
      threadId: typeof routeParams.threadId === 'string' ? routeParams.threadId : undefined,
    }),
    [
      routeParams.campaignId,
      routeParams.campaignName,
      routeParams.from,
      routeParams.listId,
      routeParams.listName,
      routeParams.threadId,
    ],
  );

  const handleEnrichPress = useCallback(() => {
    if (isMobile) {
      router.push(buildEnrichLeadPath(globalLeadId, enrichNavigationContext) as Href);
      return;
    }
    onOpenEnrich?.();
  }, [enrichNavigationContext, globalLeadId, isMobile, onOpenEnrich, router]);

  const creditsRemaining = creditBalance?.remaining ?? null;
  const enrichDisabled = !hasMatchKey || (creditsRemaining === 0 && !hasCachedEnrichment);
  const enrichButtonLabel = hasCachedEnrichment ? ENRICH_COPY.reviewButton : ENRICH_COPY.enrichButton;

  const [name, setName] = useState(initial.name);
  const [firstName, setFirstName] = useState(initial.first_name);
  const [lastName, setLastName] = useState(initial.last_name);
  const [companyName, setCompanyName] = useState(initial.company_name);
  const [website, setWebsite] = useState(initial.website);
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedin_url);
  const [phoneNumber, setPhoneNumber] = useState(initial.phone_number);
  const [mobilePhoneNumber, setMobilePhoneNumber] = useState(initial.mobile_phone_number);
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
    setMobilePhoneNumber(initial.mobile_phone_number);
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
    setMobilePhoneNumber(initial.mobile_phone_number);
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
      mobile_phone_number: mobilePhoneNumber.trim() || null,
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
    mobilePhoneNumber,
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
      description={isMobileDrill ? undefined : 'Lead and company details shared across every campaign this person belongs to.'}
      footer={footer}
    >
      {hasMultipleMemberships ? (
        <Alert
          variant="info"
          message="This person appears in multiple campaigns. Profile edits apply to all campaign copies."
        />
      ) : null}

      {error ? <Alert variant="error" message={error} /> : null}

      <View
        className={`gap-3 ${isMobile ? '' : 'flex-row items-center justify-between'} ${
          isMobileDrill ? '' : 'rounded-xl border border-[#2A2A2A] bg-[#121212] p-4'
        }`}
      >
        <View className="flex-1 min-w-0 gap-1">
          <View className="flex-row items-center gap-2 flex-wrap">
            <Text className="text-sm font-instrument-medium text-white shrink-0 leading-5">
              {ENRICH_COPY.sectionTitle}
            </Text>
            {creditBalance ? (
              <View className="shrink-0 justify-center self-center">
                <EnrichCreditBalancePill
                  creditsRemaining={creditBalance.remaining}
                  creditLimit={creditBalance.limit}
                />
              </View>
            ) : null}
          </View>
          {phonePending ? (
            <Text className="text-xs font-instrument text-blue-400">
              Mobile number may still be loading.
            </Text>
          ) : null}
          {!hasMatchKey ? (
            <Text className="text-xs font-instrument text-yellow-500">
              No email or LinkedIn on file to enrich from.
            </Text>
          ) : creditsRemaining === 0 && !hasCachedEnrichment ? (
            <Text className="text-xs font-instrument text-yellow-500">
              No enrichment credits left this month.
            </Text>
          ) : null}
        </View>
        <Button
          variant="secondary"
          size={isMobile ? 'default' : 'sm'}
          fullWidth={isMobile}
          onPress={handleEnrichPress}
          disabled={enrichDisabled}
        >
          {enrichButtonLabel}
        </Button>
      </View>

      <LeadDetailSubsection title="Lead">
        <FormTextField label="Email" value={detail.person.email} editable={false} />
        {!isMobileDrill ? (
          <Text className="text-xs text-gray-500 font-instrument -mt-2 leading-4">
            Email identifies this lead. Use Replace Lead in inbox to change it.
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
        <FormTextField
          label={ENRICH_COPY.mobileLabel}
          value={mobilePhoneNumber}
          onChangeText={setMobilePhoneNumber}
        />
        <FormTextField label="LinkedIn URL" value={linkedinUrl} onChangeText={setLinkedinUrl} autoCapitalize="none" />
      </LeadDetailSubsection>

      {!isMobileDrill ? <LeadDetailDivider /> : null}

      <LeadDetailSubsection title="Company">
        <FormTextField label="Company" value={companyName} onChangeText={setCompanyName} />
        <FormTextField
          label={ENRICH_COPY.companyPhoneLabel}
          value={phoneNumber}
          onChangeText={setPhoneNumber}
        />
        <FormTextField label="Website" value={website} onChangeText={setWebsite} autoCapitalize="none" />
      </LeadDetailSubsection>

      {Object.keys(customFields).length > 0 ? (
        <>
          {!isMobileDrill ? <LeadDetailDivider /> : null}
          <LeadDetailSubsection title="Custom">
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
