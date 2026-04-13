import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { ContactEnrichmentPanel } from '@/components/foundry/contact-enrichment/ContactEnrichmentPanel';
import { GoogleAdsVerificationPanel } from '@/components/foundry/google-ads-verification/GoogleAdsVerificationPanel';
import { StateMatchingPanel } from '@/components/foundry/state-matching/StateMatchingPanel';
import { WebsiteVerificationPanel } from '@/components/foundry/website-verification/WebsiteVerificationPanel';

type Props = {
  ingestionRunId: string;
};

export function ImportRunPipelineCard({ ingestionRunId }: Props) {
  const router = useRouter();

  return (
    <Card variant="card">
      <Text className="text-xs text-gray-500 uppercase tracking-wider mb-3">Next steps</Text>
      <Text className="text-gray-400 font-instrument text-sm mb-4 leading-5">
        Link rows in imported records, then run state matching, website verification, Google Ads verification, and
        contact enrichment when ready. Progress for normalize, linking, verification, enrichment, and queue is in the
        dials above.
      </Text>

      <StateMatchingPanel ingestionRunId={ingestionRunId} />
      <WebsiteVerificationPanel ingestionRunId={ingestionRunId} />
      <GoogleAdsVerificationPanel ingestionRunId={ingestionRunId} />
      <ContactEnrichmentPanel ingestionRunId={ingestionRunId} />

      <View className="flex-row flex-wrap items-center gap-x-1 gap-y-2 mt-4">
        <Button
          variant="link"
          size="sm"
          className="self-start px-0"
          onPress={() => router.push(`/foundry/imports/${ingestionRunId}/records`)}
        >
          Imported records
        </Button>
        <Text className="text-gray-600 font-instrument text-sm">·</Text>
        <Button variant="link" size="sm" className="self-start px-0" onPress={() => router.push('/foundry/queue')}>
          Queue
        </Button>
        <Text className="text-gray-600 font-instrument text-sm">·</Text>
        <Button variant="link" size="sm" className="self-start px-0" onPress={() => router.push('/foundry/runs')}>
          Runs
        </Button>
      </View>
    </Card>
  );
}
