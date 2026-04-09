import { Redirect } from 'expo-router';

/** `/` is not a real screen — send authorized users to the inbox. */
export default function HomeRedirect() {
  return <Redirect href="/inbox" />;
}
