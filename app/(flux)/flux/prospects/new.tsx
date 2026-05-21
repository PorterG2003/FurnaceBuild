import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { LoadingState } from '@/components/ui/feedback';
import {
  getFluxCampaigns,
  createFluxProspect,
  createFluxPage,
  checkSlugAvailable,
  ensureFluxTemplateExists,
  getFluxTemplate,
} from '@/lib/supabase/services/flux';
import type {
  FluxCampaignRow,
  FluxCampaignTemplateRow,
  BrandProfile,
  FluxCuratedDomainSeed,
  FluxWebsiteIntelSnapshot,
  FluxServiceArea,
} from '@/lib/flux/types';
import { callFluxGenerate } from '@/lib/flux/callFluxGenerate';
import { getFluxGenerateUrl } from '@/lib/flux/fluxGenerateUrl';
import { FLUX_GOOGLE_FONT_NAMES } from '@/lib/flux/googleFontsCatalog';
import {
  FluxProspectDetailsFields,
  type FluxProspectDetailsFieldValues,
} from '@/components/flux/FluxProspectDetailsFields';
import { FluxCuratedDomainsField } from '@/components/flux/FluxCuratedDomainsField';
import type { FluxBlockStylePreset } from '@/lib/flux/fluxPresentationTokens';
import { FluxGoogleFontWebLinks } from '@/components/flux/FluxGoogleFontWebLinks';
import { fetchWebsiteIntelligenceByDomain } from '@/lib/foundry/registry-client';
import fluxCompetitorAuditDiscovery from '@/lib/flux/fluxCompetitorAuditDiscovery';
import { runWebsiteIntelligenceScrapePoll } from '@/lib/flux/websiteIntelScrapePoll';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function deriveIndustryGuess(snapshot: FluxWebsiteIntelSnapshot | null): string | null {
  if (!snapshot) return null;
  return (
    snapshot.industry_guess ??
    snapshot.extracted_profile?.industries_served?.[0] ??
    snapshot.extracted_profile?.services?.[0] ??
    null
  );
}

export default function NewProspect() {
  const router = useRouter();
  const { campaignId: initialCampaignId } = useLocalSearchParams<{ campaignId?: string }>();
  const { account } = useAccount();

  const [campaigns, setCampaigns] = useState<FluxCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [campaignId, setCampaignId] = useState(initialCampaignId || '');
  const [contactName, setContactName] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [companyUrl, setCompanyUrl] = useState('');
  const [industry, setIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [emailNotes, setEmailNotes] = useState('');

  // Brand
  const [primaryColor, setPrimaryColor] = useState('#4f46e5');
  const [accentColor, setAccentColor] = useState('');
  const [fontFamily, setFontFamily] = useState('Inter');
  const [logoUrl, setLogoUrl] = useState('');
  const [brandBlockStylePreset, setBrandBlockStylePreset] = useState<FluxBlockStylePreset>('classic');
  const [foundryCompanyId, setFoundryCompanyId] = useState<string | null>(null);
  const [websiteDomainKey, setWebsiteDomainKey] = useState<string | null>(null);
  const [websiteIntelSnapshot, setWebsiteIntelSnapshot] = useState<FluxWebsiteIntelSnapshot | null>(null);
  const [websiteIntelAutoFilledAt, setWebsiteIntelAutoFilledAt] = useState<string | null>(null);
  const [websiteIntelStatus, setWebsiteIntelStatus] = useState<
    'idle' | 'loading' | 'hit' | 'stale' | 'miss' | 'scraping' | 'error'
  >('idle');
  const [websiteIntelStatusText, setWebsiteIntelStatusText] = useState('');
  const [manualOverrides, setManualOverrides] = useState({
    primaryColor: false,
    accentColor: false,
    logoUrl: false,
    industry: false,
  });
  const [serviceArea, setServiceArea] = useState<FluxServiceArea | null>(null);
  const [competitorAuditCuratedDomains, setCompetitorAuditCuratedDomains] = useState<FluxCuratedDomainSeed[] | null>(null);
  const [campaignTemplate, setCampaignTemplate] = useState<FluxCampaignTemplateRow | null>(null);

  // Slug
  const [slug, setSlug] = useState('');
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [checkingSlug, setCheckingSlug] = useState(false);

  useEffect(() => {
    if (!account) return;
    getFluxCampaigns(account.id).then((c) => {
      setCampaigns(c);
      if (!campaignId && c.length > 0) setCampaignId(c[0].id);
      setLoading(false);
    });
  }, [account]);

  useEffect(() => {
    let cancelled = false;
    if (!campaignId) {
      setCampaignTemplate(null);
      return;
    }
    getFluxTemplate(campaignId)
      .then((template) => {
        if (!cancelled) setCampaignTemplate(template);
      })
      .catch(() => {
        if (!cancelled) setCampaignTemplate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const applyIntelToForm = useCallback((snapshot: FluxWebsiteIntelSnapshot, opts?: { force?: boolean }) => {
    const force = opts?.force === true;
    const primaryCandidate = snapshot.site_assets?.theme_color ?? snapshot.site_assets?.brand_color_candidates?.[0];
    const accentCandidate =
      snapshot.site_assets?.brand_color_candidates?.find((color) => color !== primaryCandidate) ??
      snapshot.site_assets?.brand_color_candidates?.[0];
    const logoCandidate = snapshot.site_assets?.logo_candidates?.[0];
    const industryGuess = deriveIndustryGuess(snapshot);

    setWebsiteIntelSnapshot(snapshot);
    setFoundryCompanyId(snapshot.company_id ?? null);
    setWebsiteDomainKey(snapshot.normalized_domain_key ?? null);
    setWebsiteIntelAutoFilledAt(new Date().toISOString());

    if (primaryCandidate && (force || !manualOverrides.primaryColor || !primaryColor.trim())) {
      setPrimaryColor(primaryCandidate);
    }
    if (accentCandidate && (force || !manualOverrides.accentColor || !accentColor.trim())) {
      setAccentColor(accentCandidate);
    }
    if (logoCandidate && (force || !manualOverrides.logoUrl || !logoUrl.trim())) {
      setLogoUrl(logoCandidate);
    }
    if (industryGuess && (force || !manualOverrides.industry || !industry.trim())) {
      setIndustry(industryGuess);
    }
  }, [accentColor, industry, logoUrl, manualOverrides, primaryColor]);

  useEffect(() => {
    const trimmed = companyUrl.trim();
    if (!trimmed || !trimmed.includes('.')) {
      setWebsiteIntelStatus('idle');
      setWebsiteIntelStatusText('');
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setWebsiteIntelStatus('loading');
      setWebsiteIntelStatusText('Looking up cached website intel...');
      try {
        const lookup = await fetchWebsiteIntelligenceByDomain(trimmed);
        if (cancelled) return;
        if (!lookup.hit) {
          setWebsiteIntelSnapshot(null);
          setFoundryCompanyId(null);
          setWebsiteDomainKey(lookup.normalized_domain_key);
          setWebsiteIntelStatus('miss');
          setWebsiteIntelStatusText('No cached website intel yet.');
          return;
        }
        const snapshot: FluxWebsiteIntelSnapshot = {
          ...lookup,
          industry_guess: deriveIndustryGuess(lookup as FluxWebsiteIntelSnapshot),
        };
        applyIntelToForm(snapshot);
        setWebsiteIntelStatus(lookup.stale ? 'stale' : 'hit');
        setWebsiteIntelStatusText(
          lookup.stale
            ? `Stale cached data from ${new Date(lookup.crawled_at ?? Date.now()).toLocaleDateString()}`
            : `Hit cached ${new Date(lookup.crawled_at ?? Date.now()).toLocaleDateString()}`,
        );
      } catch (error: unknown) {
        if (cancelled) return;
        setWebsiteIntelStatus('error');
        setWebsiteIntelStatusText(error instanceof Error ? error.message : 'Website lookup failed.');
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [applyIntelToForm, companyUrl]);

  const handleSlugChange = (text: string) => {
    const s = slugify(text);
    setSlug(s);
    setSlugAvailable(null);
  };

  const handleSlugBlur = useCallback(async () => {
    if (!slug) { setSlugAvailable(null); return; }
    setCheckingSlug(true);
    const available = await checkSlugAvailable(slug);
    setSlugAvailable(available);
    setCheckingSlug(false);
  }, [slug]);

  const prospectDetailValues = useMemo(
    (): FluxProspectDetailsFieldValues => ({
      name: contactName,
      company,
      role,
      url: companyUrl,
      industry,
      company_size: companySize,
      email_notes: emailNotes,
      brand_primaryColor: primaryColor,
      brand_accentColor: accentColor,
      brand_fontFamily: fontFamily,
      brand_logoUrl: logoUrl,
      brand_blockStylePreset: brandBlockStylePreset,
      service_area: serviceArea,
      competitor_audit_curated_domains: competitorAuditCuratedDomains,
    }),
    [
      contactName,
      company,
      role,
      companyUrl,
      industry,
      companySize,
      emailNotes,
      primaryColor,
      accentColor,
      fontFamily,
      logoUrl,
      brandBlockStylePreset,
      serviceArea,
      competitorAuditCuratedDomains,
    ],
  );

  const selectedCuratedAuditBlock = useMemo(
    () =>
      campaignTemplate?.blocks.find(
        (block) => block.type === 'competitor_ad_audit' && (block.props.discoveryMode ?? 'local_places') === 'curated_domains',
      ),
    [campaignTemplate],
  );

  const patchProspectDetails = useCallback((patch: Partial<FluxProspectDetailsFieldValues>) => {
    if (patch.name !== undefined) setContactName(patch.name);
    if (patch.company !== undefined) setCompany(patch.company);
    if (patch.role !== undefined) setRole(patch.role);
    if (patch.url !== undefined) setCompanyUrl(patch.url);
    if (patch.industry !== undefined) setIndustry(patch.industry);
    if (patch.company_size !== undefined) setCompanySize(patch.company_size);
    if (patch.email_notes !== undefined) setEmailNotes(patch.email_notes);
    if (patch.brand_primaryColor !== undefined) setPrimaryColor(patch.brand_primaryColor);
    if (patch.brand_accentColor !== undefined) setAccentColor(patch.brand_accentColor);
    if (patch.brand_fontFamily !== undefined) setFontFamily(patch.brand_fontFamily);
    if (patch.brand_logoUrl !== undefined) setLogoUrl(patch.brand_logoUrl);
    if (patch.brand_blockStylePreset !== undefined) setBrandBlockStylePreset(patch.brand_blockStylePreset);
    if (patch.service_area !== undefined) setServiceArea(patch.service_area);
    if (patch.competitor_audit_curated_domains !== undefined) {
      setCompetitorAuditCuratedDomains(patch.competitor_audit_curated_domains);
    }
  }, []);

  const handleSubmit = async () => {
    if (!account || !campaignId || !contactName || !company || !slug || submitting) return;
    if (slugAvailable === false) {
      Alert.alert('Slug unavailable', 'That URL slug is already taken. Choose a different one.');
      return;
    }

    setSubmitting(true);
    try {
      const persistedWebsiteIntel =
        websiteIntelSnapshot && JSON.stringify(websiteIntelSnapshot).length <= 24 * 1024
          ? websiteIntelSnapshot
          : null;
      const brandProfile: BrandProfile = {
        primaryColor,
        accentColor: accentColor || undefined,
        fontFamily: fontFamily || undefined,
        logoUrl: logoUrl || undefined,
        blockStylePreset: brandBlockStylePreset,
      };
      const parsedCuratedDomains = fluxCompetitorAuditDiscovery.parseFluxCuratedDomains(competitorAuditCuratedDomains);

      const prospect = await createFluxProspect({
        account_id: account.id,
        campaign_id: campaignId,
        name: contactName,
        company,
        role: role || undefined,
        url: companyUrl || undefined,
        industry: industry || undefined,
        company_size: companySize || undefined,
        email_notes: emailNotes || undefined,
        brand_profile: brandProfile,
        foundry_company_id: foundryCompanyId,
        website_domain_key: websiteDomainKey,
        website_intel_snapshot: persistedWebsiteIntel,
        website_intel_auto_filled_at: persistedWebsiteIntel ? websiteIntelAutoFilledAt : null,
        service_area: serviceArea,
        competitor_audit_curated_domains: parsedCuratedDomains.length > 0 ? parsedCuratedDomains : null,
      });

      await createFluxPage({
        prospect_id: prospect.id,
        campaign_id: campaignId,
        account_id: account.id,
        slug,
        status: 'draft',
      });

      if (getFluxGenerateUrl()) {
        const campaignTemplate = await ensureFluxTemplateExists(campaignId);
        if (!campaignTemplate.blocks.length) {
          Alert.alert(
            'Prospect created',
            'The page was saved, but the campaign template has no blocks yet. Open the campaign editor, add blocks, save, then use Regenerate on the prospect screen.',
          );
        } else {
          const gen = await callFluxGenerate({ prospectId: prospect.id, campaignId });
          if (!gen.ok) {
            Alert.alert(
              'Prospect created',
              `The page was saved, but generation failed: ${gen.message}. You can try Regenerate on the prospect screen.`,
            );
          }
        }
      }

      router.replace(`/flux/prospects/${prospect.id}` as Href);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create prospect');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshFromWebsite = useCallback(async (force = true) => {
    const trimmed = companyUrl.trim();
    if (!trimmed) {
      Alert.alert('Company URL required', 'Enter a company website first.');
      return;
    }
    setWebsiteIntelStatus('scraping');
    setWebsiteIntelStatusText('Scraping website...');
    try {
      const result = await runWebsiteIntelligenceScrapePoll({ url: trimmed, force });
      if (!result.ok) {
        throw new Error(result.message);
      }
      if (!result.snapshot) {
        setWebsiteIntelStatus('miss');
        setWebsiteIntelStatusText(result.message || 'No usable website intel was found.');
        return;
      }
      applyIntelToForm(result.snapshot, { force: true });
      setWebsiteIntelStatus(result.stale ? 'stale' : 'hit');
      setWebsiteIntelStatusText('Website intel updated.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Website scrape failed.';
      setWebsiteIntelStatus('error');
      setWebsiteIntelStatusText(message);
      Alert.alert('Website refresh failed', message);
    }
  }, [applyIntelToForm, companyUrl]);

  const intelChipText = useMemo(() => {
    switch (websiteIntelStatus) {
      case 'loading':
        return 'Looking up...';
      case 'hit':
        return websiteIntelStatusText || 'Hit';
      case 'stale':
        return websiteIntelStatusText || 'Stale';
      case 'miss':
        return websiteIntelStatusText || 'No data';
      case 'scraping':
        return websiteIntelStatusText || 'Scraping...';
      case 'error':
        return websiteIntelStatusText || 'Lookup failed';
      default:
        return '';
    }
  }, [websiteIntelStatus, websiteIntelStatusText]);

  if (loading) {
    return (
      <View className="flex-1">
        <LoadingState message="Loading…" />
      </View>
    );
  }

  const inputClass = 'text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm mb-3';
  const labelClass = 'text-gray-400 text-xs font-instrument mb-1';

  return (
    <>
      <FluxGoogleFontWebLinks families={FLUX_GOOGLE_FONT_NAMES} />
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <PageHeader
        title="New prospect"
        subtitle="Creates the contact, page slug, and runs generate when Flux is configured"
      />

      {/* Campaign picker */}
      <Text className={labelClass}>Campaign</Text>
      <View className="flex-row flex-wrap gap-2 mb-4">
        {campaigns.map((c) => (
          <Pressable
            key={c.id}
            className={`px-3 py-2 rounded-xl border ${campaignId === c.id ? 'border-[#f85102] bg-[#f85102]/12' : 'border-[#2A2A2A] bg-[#1A1A1A]'}`}
            onPress={() => setCampaignId(c.id)}
          >
            <Text className="text-white text-sm font-instrument">{c.name}</Text>
          </Pressable>
        ))}
      </View>

      <FluxProspectDetailsFields
        values={prospectDetailValues}
        onChange={(patch) => {
          if (patch.industry !== undefined && websiteIntelAutoFilledAt) {
            setManualOverrides((current) => ({ ...current, industry: true }));
          }
          if (patch.brand_primaryColor !== undefined && websiteIntelAutoFilledAt) {
            setManualOverrides((current) => ({ ...current, primaryColor: true }));
          }
          if (patch.brand_accentColor !== undefined && websiteIntelAutoFilledAt) {
            setManualOverrides((current) => ({ ...current, accentColor: true }));
          }
          if (patch.brand_logoUrl !== undefined && websiteIntelAutoFilledAt) {
            setManualOverrides((current) => ({ ...current, logoUrl: true }));
          }
          patchProspectDetails(patch);
        }}
        belowCompanyUrlSlot={
          (websiteIntelStatus !== 'idle' || websiteIntelSnapshot) ? (
            <View className="mb-4 gap-2">
              <View className="self-start px-3 py-2 rounded-full border border-[#2A2A2A] bg-[#1A1A1A]">
                <Text className="text-xs text-gray-300 font-instrument">{intelChipText}</Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Button size="2xs" variant="secondary" onPress={() => handleRefreshFromWebsite(true)}>
                  Refresh from Website
                </Button>
                {websiteIntelSnapshot ? (
                  <Button
                    size="2xs"
                    variant="secondary"
                    onPress={() => applyIntelToForm(websiteIntelSnapshot, { force: true })}
                  >
                    Re-apply from Website
                  </Button>
                ) : null}
              </View>
            </View>
          ) : null
        }
        belowServiceAreaSlot={
          selectedCuratedAuditBlock ? (
            <View className="mb-3">
              <FluxCuratedDomainsField
                value={competitorAuditCuratedDomains}
                onChange={(next) => setCompetitorAuditCuratedDomains(next)}
                labelClassName={labelClass}
                inputClassName={inputClass}
                title="Competitor domains (this prospect)"
                helperText="Overrides campaign defaults when you list at least 3 domains; otherwise the template list is used."
              />
            </View>
          ) : null
        }
        inputClassName={inputClass}
        labelClassName={labelClass}
      />

      {/* Slug */}
      <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 mt-4 font-instrument-semibold">Page URL</Text>
      <Text className={labelClass}>Slug *</Text>
      <TextInput
        className={inputClass}
        value={slug}
        onChangeText={handleSlugChange}
        onBlur={handleSlugBlur}
        placeholder="acme-q4-growth"
        placeholderTextColor="#555"
        autoCapitalize="none"
      />
      {slug ? (
        <View className="flex-row items-center mb-3 gap-2">
          <Text className="text-gray-400 text-xs font-instrument">URL: /p/{slug}</Text>
          {checkingSlug && <ActivityIndicator size="small" color="#6b7280" />}
          {slugAvailable === true && <Text className="text-green-400 text-xs">✓ Available</Text>}
          {slugAvailable === false && <Text className="text-red-400 text-xs">✕ Taken</Text>}
        </View>
      ) : null}

      {/* Submit */}
      <View className="mt-4">
        <Button
          onPress={handleSubmit}
          disabled={submitting || !campaignId || !contactName || !company || !slug || slugAvailable === false}
          fullWidth
        >
          {submitting ? 'Creating...' : 'Create Prospect & Generate Page'}
        </Button>
      </View>
    </ScrollView>
    </>
  );
}
