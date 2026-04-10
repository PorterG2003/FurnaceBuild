import { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { postImportScopedWebsiteVerification } from '@/lib/foundry/registry-client';
import type { PostStartWebsiteVerificationJobResponse } from '@/lib/foundry/registry-types';

function summarizeWebsiteVerificationResponse(r: PostStartWebsiteVerificationJobResponse): string | null {
  const ready = Array.isArray(r.preflight?.ready) ? r.preflight.ready : [];
  const missing = Array.isArray(r.preflight?.missing_website) ? r.preflight.missing_website : [];
  if (ready.length === 0) {
    if (missing.length > 0) {
      return `${missing.length} linked companies do not have a website on file, so nothing will run until those rows are fixed.`;
    }
    return 'No linked companies are ready for website verification.';
  }
  if (missing.length > 0) {
    return `${ready.length} linked companies will run website verification. ${missing.length} will be skipped because they do not have a website on file.`;
  }
  return `${ready.length} linked companies will run website verification.`;
}

type Props = {
  ingestionRunId: string;
};

export function WebsiteVerificationPanel({ ingestionRunId }: Props) {
  const router = useRouter();
  const [summary, setSummary] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <View className="mt-4">
      <Text className="text-gray-300 font-instrument-semibold text-sm mb-2">Website verification</Text>
      <Text className="text-gray-500 font-instrument text-xs mb-3 leading-5">
        Start one background job for linked companies in this import. We load the on-file website in headed Chrome,
        crawl the same domain, and score whether it appears to belong to the company.
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
            const result = await postImportScopedWebsiteVerification(ingestionRunId);
            setSummary(summarizeWebsiteVerificationResponse(result));
            setJobId(result.jobId);
            setReused(Boolean(result.reused));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to start website verification');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Starting…' : 'Start website verification'}
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
