import { Slot } from 'expo-router';
import { Authenticator } from '@aws-amplify/ui-react-native';
import { Amplify } from 'aws-amplify';
  import outputs from '../../amplify_outputs.json';

Amplify.configure(outputs);

export default function AuthLayout() {
  return (
    <Authenticator.Provider>
      <Slot />
    </Authenticator.Provider>
  );
}
