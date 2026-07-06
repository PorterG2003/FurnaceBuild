import { Text, View } from 'react-native';
import { OpenConversationIndicator } from './OpenConversationIndicator';
import { OPEN_CONVERSATION_ACTION_TEXT } from './inboxConstants';

type OpenConversationCountLabelProps = {
  count: number;
};

function formatCount(count: number): string {
  if (count > 99) return '99+';
  return String(count);
}

export function OpenConversationCountLabel({ count }: OpenConversationCountLabelProps) {
  if (count <= 0) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginLeft: 'auto',
        flexShrink: 0,
      }}
    >
      <OpenConversationIndicator size="compact" />
      <Text
        className="font-instrument-semibold text-sm tabular-nums"
        style={{ color: OPEN_CONVERSATION_ACTION_TEXT }}
      >
        {formatCount(count)}
      </Text>
    </View>
  );
}
