import { Stack, usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { InboxScreen } from '@/components/inbox/InboxScreen';
import { InboxThreadActionProvider } from '@/contexts/InboxThreadActionContext';
import { isReplaceLeadInboxPath, parseInboxThreadIdFromPathname } from '@/lib/inbox/inboxRoutes';

export default function InboxLayout() {
  const pathname = usePathname();
  const showInboxShell = !isReplaceLeadInboxPath(pathname);
  const routeThreadId = showInboxShell ? parseInboxThreadIdFromPathname(pathname) : null;

  return (
    <InboxThreadActionProvider>
      <View style={styles.root}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'none',
            contentStyle: styles.stackContent,
          }}
        >
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="[threadId]" options={{ animation: 'none' }} />
          <Stack.Screen name="replace-lead" options={{ animation: 'none' }} />
        </Stack>
        {showInboxShell ? (
          <View style={styles.inboxShell}>
            <InboxScreen routeThreadId={routeThreadId} />
          </View>
        ) : null}
      </View>
    </InboxThreadActionProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#121212',
  },
  stackContent: {
    flex: 1,
    backgroundColor: '#121212',
  },
  inboxShell: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
});
