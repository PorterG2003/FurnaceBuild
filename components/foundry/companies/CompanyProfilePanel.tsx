import { View, Text, Pressable, Linking } from 'react-native';
import type { CompanyWebsiteVerificationRow, RegistryCompanyDetailRow } from '@/lib/foundry/registry-types';
import { formatDetailTimestamp, dash, normalizeWebsiteHref } from './companyDetailFormat';

function verificationTone(verification: CompanyWebsiteVerificationRow | null | undefined): string {
  const band = verification?.band;
  if (band === 'usable') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
  if (band === 'uncertain') return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
  if (band === 'not_usable') return 'text-red-300 bg-red-500/10 border-red-500/30';
  return 'text-gray-400 bg-[#2A2A2A] border-[#3A3A3A]';
}

export function CompanyProfilePanel({
  company,
  website,
  verification,
}: {
  company: RegistryCompanyDetailRow;
  /** Prefer a linked source row’s website; omitted when unknown. */
  website?: string | null;
  verification?: CompanyWebsiteVerificationRow | null;
}) {
  const webHref = website?.trim() ? normalizeWebsiteHref(website.trim()) : '';

  return (
    <View className="p-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
      <Text className="text-gray-500 font-instrument text-[10px] uppercase tracking-wider mb-3">Profile</Text>
      <Text className="text-gray-500 font-instrument text-xs mb-1">Company ID</Text>
      <Text selectable className="text-gray-300 font-mono text-xs leading-5 mb-4">
        {company.id}
      </Text>
      <Text className="text-gray-500 font-instrument text-xs mb-1">Website</Text>
      {website?.trim() ? (
        <Pressable onPress={() => webHref && void Linking.openURL(webHref)} className="mb-4 self-start">
          <Text className="text-brand-orange font-instrument text-sm underline" numberOfLines={3}>
            {website.trim()}
          </Text>
        </Pressable>
      ) : (
        <Text className="text-gray-500 font-instrument text-sm mb-4">{dash(null)}</Text>
      )}
      <Text className="text-gray-500 font-instrument text-xs mb-1">Website verification</Text>
      {verification ? (
        <View className="mb-4">
          <View className={`self-start px-2 py-1 rounded-full border ${verificationTone(verification)}`}>
            <Text className="font-instrument text-xs">
              {verification.band ? verification.band.replace('_', ' ') : 'error'} · {dash(verification.score)}
            </Text>
          </View>
          <Text className="text-gray-500 font-instrument text-xs mt-2">
            {formatDetailTimestamp(verification.verified_at)}
          </Text>
          {verification.error ? (
            <Text className="text-red-300/90 font-instrument text-xs mt-2 leading-5">{verification.error}</Text>
          ) : null}
        </View>
      ) : (
        <Text className="text-gray-500 font-instrument text-sm mb-4">Not verified</Text>
      )}
      {company.notes ? (
        <>
          <Text className="text-gray-500 font-instrument text-xs mb-1">Notes</Text>
          <Text className="text-gray-300 font-instrument text-sm mb-4 leading-5">{company.notes}</Text>
        </>
      ) : null}
      <Text className="text-gray-500 font-instrument text-xs mb-1">Created</Text>
      <Text className="text-gray-400 font-instrument text-sm mb-2">{formatDetailTimestamp(company.created_at)}</Text>
      <Text className="text-gray-500 font-instrument text-xs mb-1">Updated</Text>
      <Text className="text-gray-400 font-instrument text-sm">{formatDetailTimestamp(company.updated_at)}</Text>
      <Text className="text-gray-500 font-instrument text-xs mt-4 mb-1">Normalized key</Text>
      <Text className="text-gray-400 font-mono text-xs">{dash(company.normalized_key)}</Text>
    </View>
  );
}
