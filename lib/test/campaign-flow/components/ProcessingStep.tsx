import { View, Text, ActivityIndicator } from 'react-native';

interface ProcessingStepProps {
  creating?: boolean;
  progress?: {
    step: string;
    current?: number;
    total?: number;
  } | null;
}

export function ProcessingStep({ creating = true, progress }: ProcessingStepProps) {
  const getProgressText = () => {
    if (!progress) {
      return creating
        ? 'Setting up test campaign, mailboxes, and leads...'
        : 'Waiting for test setup...';
    }

    if (progress.current !== undefined && progress.total !== undefined) {
      return `${progress.step} (${progress.current}/${progress.total})`;
    }

    return progress.step;
  };

  return (
    <View>
      <Text className="text-lg font-instrument-semibold text-white mb-4">Creating Test...</Text>
      <View className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6">
        <ActivityIndicator size="large" color="#f85102" />
        <Text className="text-gray-400 font-instrument text-sm mt-4 text-center">
          {getProgressText()}
        </Text>
        {progress?.current !== undefined && progress?.total !== undefined && (
          <View className="mt-4">
            <View className="bg-[#2A2A2A] rounded-full h-2 overflow-hidden">
              <View
                className="bg-brand-orange h-full rounded-full"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                  backgroundColor: '#f85102',
                }}
              />
            </View>
            <Text className="text-gray-500 font-instrument text-xs text-center mt-2">
              {Math.round((progress.current / progress.total) * 100)}% complete
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

