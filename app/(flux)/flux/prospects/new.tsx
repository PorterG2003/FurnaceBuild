import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import { useAccount } from '@/contexts/AccountContext';
import { Button } from '@/components/ui/button';
import {
  getFluxCampaigns,
  createFluxProspect,
  createFluxPage,
  checkSlugAvailable,
  ensureFluxTemplateExists,
} from '@/lib/supabase/services/flux';
import type { FluxCampaignRow, BrandProfile } from '@/lib/flux/types';
import { callFluxGenerate } from '@/lib/flux/callFluxGenerate';
import { getFluxGenerateUrl } from '@/lib/flux/fluxGenerateUrl';
import { FLUX_GOOGLE_FONT_NAMES } from '@/lib/flux/googleFontsCatalog';
import { FluxFontFamilyPicker } from '@/components/flux/FluxFontFamilyPicker';
import { FluxGoogleFontWebLinks } from '@/components/flux/FluxGoogleFontWebLinks';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
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

  const handleSubmit = async () => {
    if (!account || !campaignId || !contactName || !company || !slug || submitting) return;
    if (slugAvailable === false) {
      Alert.alert('Slug unavailable', 'That URL slug is already taken. Choose a different one.');
      return;
    }

    setSubmitting(true);
    try {
      const brandProfile: BrandProfile = {
        primaryColor,
        accentColor: accentColor || undefined,
        fontFamily: fontFamily || undefined,
        logoUrl: logoUrl || undefined,
      };

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
      });

      await createFluxPage({
        prospect_id: prospect.id,
        campaign_id: campaignId,
        account_id: account.id,
        slug,
        status: 'draft',
      });

      if (getFluxGenerateUrl()) {
        await ensureFluxTemplateExists(campaignId);
        const gen = await callFluxGenerate({ prospectId: prospect.id, campaignId });
        if (!gen.ok) {
          Alert.alert('Prospect created', `The page was saved, but generation failed: ${gen.message}. You can try Regenerate on the prospect screen.`);
        }
      }

      router.replace(`/flux/prospects/${prospect.id}` as Href);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create prospect');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#6b7280" />
      </View>
    );
  }

  const inputClass = 'text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm mb-3';
  const labelClass = 'text-gray-400 text-xs font-instrument mb-1';

  return (
    <>
      <FluxGoogleFontWebLinks families={FLUX_GOOGLE_FONT_NAMES} />
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Pressable onPress={() => router.back()} className="mb-4">
        <Text className="text-gray-400 text-sm font-instrument">← Back</Text>
      </Pressable>

      <Text className="text-white text-xl font-instrument-semibold mb-6">New Prospect</Text>

      {/* Campaign picker */}
      <Text className={labelClass}>Campaign</Text>
      <View className="flex-row flex-wrap gap-2 mb-4">
        {campaigns.map((c) => (
          <Pressable
            key={c.id}
            className={`px-3 py-2 rounded-xl border ${campaignId === c.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-[#2A2A2A] bg-[#1A1A1A]'}`}
            onPress={() => setCampaignId(c.id)}
          >
            <Text className="text-white text-sm font-instrument">{c.name}</Text>
          </Pressable>
        ))}
      </View>

      {/* Prospect details */}
      <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 font-instrument-semibold">Prospect Details</Text>
      <Text className={labelClass}>Contact Name *</Text>
      <TextInput className={inputClass} value={contactName} onChangeText={setContactName} placeholder="Jane Smith" placeholderTextColor="#555" />
      <Text className={labelClass}>Company *</Text>
      <TextInput className={inputClass} value={company} onChangeText={setCompany} placeholder="Acme Corp" placeholderTextColor="#555" />
      <Text className={labelClass}>Role</Text>
      <TextInput className={inputClass} value={role} onChangeText={setRole} placeholder="VP of Sales" placeholderTextColor="#555" />
      <Text className={labelClass}>Company URL</Text>
      <TextInput className={inputClass} value={companyUrl} onChangeText={setCompanyUrl} placeholder="https://acme.com" placeholderTextColor="#555" autoCapitalize="none" />
      <Text className={labelClass}>Industry</Text>
      <TextInput className={inputClass} value={industry} onChangeText={setIndustry} placeholder="SaaS" placeholderTextColor="#555" />
      <Text className={labelClass}>Company Size</Text>
      <TextInput className={inputClass} value={companySize} onChangeText={setCompanySize} placeholder="50-200" placeholderTextColor="#555" />
      <Text className={labelClass}>Email Notes</Text>
      <TextInput
        className={`${inputClass} min-h-[80px]`}
        value={emailNotes}
        onChangeText={setEmailNotes}
        placeholder="Paste relevant context from the email thread..."
        placeholderTextColor="#555"
        multiline
        textAlignVertical="top"
      />

      {/* Brand profile */}
      <Text className="text-gray-500 text-xs uppercase tracking-wider mb-3 mt-4 font-instrument-semibold">Brand Profile</Text>
      <Text className={labelClass}>Primary Color</Text>
      <View className="flex-row items-center gap-3 mb-3">
        <View className="w-8 h-8 rounded-lg border border-[#3A3A3A]" style={{ backgroundColor: primaryColor }} />
        <TextInput
          className="flex-1 text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm"
          value={primaryColor}
          onChangeText={setPrimaryColor}
          placeholder="#4f46e5"
          placeholderTextColor="#555"
          autoCapitalize="none"
        />
      </View>
      <Text className={labelClass}>Accent Color (optional)</Text>
      <View className="flex-row items-center gap-3 mb-3">
        <View className="w-8 h-8 rounded-lg border border-[#3A3A3A]" style={{ backgroundColor: accentColor || '#transparent' }} />
        <TextInput
          className="flex-1 text-white bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm"
          value={accentColor}
          onChangeText={setAccentColor}
          placeholder="#10b981"
          placeholderTextColor="#555"
          autoCapitalize="none"
        />
      </View>
      <Text className={labelClass}>Font Family</Text>
      <FluxFontFamilyPicker value={fontFamily} onChange={setFontFamily} />
      <Text className={labelClass}>Logo URL (optional)</Text>
      <TextInput className={inputClass} value={logoUrl} onChangeText={setLogoUrl} placeholder="https://acme.com/logo.png" placeholderTextColor="#555" autoCapitalize="none" />

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
