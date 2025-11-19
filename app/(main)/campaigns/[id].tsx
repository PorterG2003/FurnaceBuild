import { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { NavBar } from '@/components/ui/NavBar';
import { Background } from '@/components/ui/Background';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { useBackground } from '@/contexts/BackgroundContext';
import { getCampaignById } from '@/lib/supabase/services/campaigns';
import type { Campaign } from '@/lib/supabase/types';

export default function CampaignPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setVariant } = useBackground();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Set solid background for campaign page
    setVariant('solid');
    
    // Cleanup: reset to solid when leaving
    return () => {
      setVariant('solid');
    };
  }, [setVariant]);

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
    <View className="flex-1 bg-[#121212] flex-row">
      <NavBar />
      
      {/* Main Content Area */}
      <View className="flex-1 relative">
        <Background />

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
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
        >

          {/* Placeholder Content */}
          <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-8">
            <Text className="text-white font-instrument-semibold text-xl mb-4">
              Insights Coming Soon
            </Text>
            <Text className="text-gray-400 font-instrument">
              Campaign analytics and performance metrics will be displayed here.
            </Text>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

