import { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PageLayout } from '@/components/ui/PageLayout';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { LoadingState } from '@/components/ui/LoadingState';
import { getCampaignById } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';

export default function CampaignPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadCampaign = async () => {
      if (!id) return;

      setIsLoading(true);
      try {
        const data = await getCampaignById(id);
        setCampaign(data);
      } catch (err) {
        console.error('Error loading campaign:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadCampaign();
  }, [id]);

  return (
    <PageLayout scrollable={false} contentPadding={0}>
      {/* Header with Breadcrumb */}
      <View 
        style={{
          backgroundColor: '#121212',
          borderBottomWidth: 1,
          borderBottomColor: '#2A2A2A',
          paddingHorizontal: 24,
          paddingVertical: 16,
          zIndex: 10,
        }}
      >
        <Breadcrumb
          items={[
            { label: 'Campaigns', href: '/campaigns' },
            { 
              label: isLoading ? 'Loading...' : campaign?.name || 'Campaign'                                                                         
            },
          ]}
        />
      </View>

      {/* Content */}
      {isLoading ? (
        <LoadingState message="Loading campaign..." />
      ) : (
        <View className="flex-1" style={{ padding: 24 }}>
          {/* Placeholder Content */}
          <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-8">
            <Text className="text-white font-instrument-semibold text-xl mb-4">
              Insights Coming Soon
            </Text>
            <Text className="text-gray-400 font-instrument">
              Campaign analytics and performance metrics will be displayed here.
            </Text>
          </View>
        </View>
      )}
    </PageLayout>
  );
}

