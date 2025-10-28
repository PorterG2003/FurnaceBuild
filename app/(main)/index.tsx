import { View, Text } from 'react-native';
import { useAuthenticator } from '@aws-amplify/ui-react-native';
import { Button } from '@/components/ui/button';

export default function Home() {
  const { signOut, user } = useAuthenticator();

  return (
    <View className="flex-1 bg-white items-center justify-center gap-4 px-4">
      <Text className="text-2xl font-bold text-center">
        Welcome to FurnaceBuild!
      </Text>
      {user && (
        <Text className="text-lg text-gray-600">
          Logged in as: {user.username}
        </Text>
      )}
      <Button onPress={signOut} variant="outline">
        Sign Out
      </Button>
    </View>
  );
}

