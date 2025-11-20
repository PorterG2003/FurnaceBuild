import { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { NavBar } from '@/components/ui/NavBar';
import { Background } from '@/components/ui/Background';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { useBackground } from '@/contexts/BackgroundContext';

export default function SendersPage() {
  const { user } = useAuthenticator();
  const { setVariant } = useBackground();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Set solid background for senders page
    setVariant('solid');
    
    // Cleanup: reset to solid when leaving
    return () => {
      setVariant('solid');
    };
  }, [setVariant]);

  return (
    <View className="flex-1 bg-[#121212] flex-row">
      <NavBar />
      
      {/* Main Content Area */}
      <View className="flex-1 relative">
        <Background />

        {/* Content */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View className="mb-6">
            <Text className="text-3xl font-instrument-semibold text-white mb-2">
              Senders
            </Text>
            <Text className="text-gray-400 font-instrument">
              Manage your email senders and domains
            </Text>
          </View>

          {/* Loading State */}
          {isLoading ? (
            <View className="items-center justify-center py-20">
              <ActivityIndicator size="large" color="#f85102" />
              <Text className="text-gray-400 font-instrument mt-4">
                Loading senders...
              </Text>
            </View>
          ) : (
            /* Placeholder Content */
            <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-8">
              <Text className="text-white font-instrument-semibold text-xl mb-4">
                Senders Coming Soon
              </Text>
              <Text className="text-gray-400 font-instrument">
                Email sender management and domain configuration will be displayed here.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

