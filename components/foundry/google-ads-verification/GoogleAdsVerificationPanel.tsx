import { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { postImportScopedGoogleAdsVerification } from '@/lib/foundry/registry-client';
import type { PostStartGoogleAdsVerificationJobResponse } from '@/lib/foundry/registry-types';

function summarizeGoogleAdsVerificationResponse(r: PostStartGoogleAdsVerificationJobResponse): string | null {
  const ready = Array.isArray(r.preflight?.ready) ? r.preflight.ready : [];
  const missing = Array.isArray(r.preflight?.missing_verified_website) ? r.preflight.missing_verified_website : [];
  if (ready.length === 0) {
    if (missing.length > 0) {
      return `${missing.length} linked companies do not have a usable verified website yet, so nothing will run until website verification is completed.`;
    }
    return 'No linked companies are ready for Google Ads verification.';
  }
  if (missing.length > 0) {
    return `${ready.length} linked companies will run Google Ads verification. ${missing.length} will be skipped because they do not have a usable verified website yet.`;
  }
  return `${ready.length} linked companies will run Google Ads verification.`;
}

type Props = {
  ingestionRunId: string;
};

export function GoogleAdsVerificationPanel({ ingestionRunId }: Props) {
  const router = useRouter();
  const [summary, setSummary] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <View className="mt-4">
      <Text className="text-gray-300 font-instrument-semibold text-sm mb-2">Google Ads verification</Text>
      <Text className="text-gray-500 font-instrument text-xs mb-3 leading-5">
        Start one background job for linked companies in this import. We use the latest usable verified website,
        search the Google Ads Transparency Center in headed Chrome, and record whether the domain shows active Google
        ad results.
      </Text>
      {error ? <Text className="text-red-400 mb-2 font-instrument text-sm">{error}</Text> : null}
      <Button
        variant="default"
        size="sm"
        disabled={busy}
        className="mb-3 self-start"
        onPress={async () => {
          setBusy(true);
          setError(null);
          setSummary(null);
          setJobId(null);
          setReused(false);
          try {
            const result = await postImportScopedGoogleAdsVerification(ingestionRunId);
            setSummary(summarizeGoogleAdsVerificationResponse(result));
            setJobId(result.jobId);
            setReused(Boolean(result.reused));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start Google Ads verification');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Starting…' : 'Start Google Ads verification'}
      </Button>
      {summary ? (
        <Text className="text-amber-200/90 font-instrument text-xs mb-2 leading-5">
          {reused ? 'A matching job is already running for this import. ' : ''}
          {summary}
        </Text>
      ) : null}
      {jobId ? (
        <View className="mb-2">
          <Text className="text-emerald-300/90 font-instrument text-xs mb-1">
            {reused ? 'Using existing job' : 'Started job'} {jobId}
          </Text>
          <Button variant="link" size="sm" className="self-start px-0 mt-1" onPress={() => router.push('/foundry/runs')}>
            Open Runs
          </Button>
        </View>
      ) : null}
    </View>
  );
}
