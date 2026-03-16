import { Text, View } from 'react-native';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

function toneClasses(tone: Tone) {
  if (tone === 'success') {
    return {
      bg: 'bg-green-500/10',
      border: 'border-green-500/20',
      text: 'text-green-300',
    };
  }
  if (tone === 'warning') {
    return {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      text: 'text-amber-300',
    };
  }
  if (tone === 'danger') {
    return {
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      text: 'text-red-300',
    };
  }
  return {
    bg: 'bg-[#1F1F1F]',
    border: 'border-[#2A2A2A]',
    text: 'text-gray-300',
  };
}

export function MigrationStatusPill({
  label,
  tone,
}: {
  label: string;
  tone: Tone;
}) {
  const classes = toneClasses(tone);
  return (
    <View className={`self-start rounded-full border px-2.5 py-1 ${classes.bg} ${classes.border}`}>
      <Text className={`text-xs font-instrument-medium capitalize ${classes.text}`}>{label}</Text>
    </View>
  );
}

export function MigrationInlineNotice({
  title,
  body,
  tone = 'neutral',
}: {
  title?: string;
  body: string;
  tone?: Tone;
}) {
  const classes = toneClasses(tone);
  return (
    <View className={`rounded-lg border px-3 py-3 ${classes.bg} ${classes.border}`}>
      {title ? <Text className={`text-xs font-instrument-medium ${classes.text}`}>{title}</Text> : null}
      <Text className={`text-xs font-instrument ${title ? 'mt-1 ' : ''}${classes.text}`}>{body}</Text>
    </View>
  );
}
