import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import type { FluxChatMessage } from '@/lib/flux/editor/reducer';

function isNeedsNewBlockMessage(content: string): boolean {
  return /^needs new block:/i.test(content.trim());
}

interface FluxChatPanelProps {
  messages: FluxChatMessage[];
  lastSummary: string[] | null;
  showLastSummary?: boolean;
  sending: boolean;
  error: string | null;
  canUndo: boolean;
  chatConfigured: boolean;
  emptyStateText?: string;
  composerPlaceholder?: string;
  footer?: React.ReactNode;
  onSend: (text: string) => Promise<void>;
  onUndo: () => void;
}

export function FluxChatPanel({
  messages,
  lastSummary,
  showLastSummary = false,
  sending,
  error,
  canUndo,
  chatConfigured,
  emptyStateText = 'Start by describing the audience, the deliverable, and why the page should feel custom to each lead.',
  composerPlaceholder = 'Ask Flux to shape the campaign…',
  footer,
  onSend,
  onUndo,
}: FluxChatPanelProps) {
  const [draft, setDraft] = useState('');

  const submit = useCallback(async () => {
    const t = draft.trim();
    if (!t || sending) return;
    setDraft('');
    await onSend(t);
  }, [draft, sending, onSend]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
      style={{ minHeight: 0 }}
    >
      {!chatConfigured ? (
        <Alert
          variant="warning"
          message="Editor chat URL is not configured. Deploy the backend or set EXPO_PUBLIC_FLUX_EDITOR_CHAT_URL."
          className="mb-1.5"
        />
      ) : null}
      {error ? <Alert variant="error" message={error} className="mb-1.5" /> : null}
      {showLastSummary && lastSummary && lastSummary.length > 0 ? (
        <View className="mb-2 border border-[#2A2A2A] rounded-xl p-2.5 bg-[#141414]">
          <Text className="text-gray-500 text-xs uppercase tracking-wider font-instrument-semibold mb-1">
            Last applied
          </Text>
          {lastSummary.map((line, i) => (
            <Text key={i} className="text-gray-300 text-xs font-instrument leading-5">
              • {line}
            </Text>
          ))}
        </View>
      ) : null}
      <ScrollView
        className="flex-1 mb-2 rounded-xl"
        style={{ minHeight: 0 }}
        contentContainerStyle={{ padding: 10, paddingBottom: 12, flexGrow: messages.length === 0 ? 1 : undefined }}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <Text className="text-gray-500 text-sm font-instrument text-center py-6">
            {emptyStateText}
          </Text>
        ) : (
          messages.map((m) => (
            <View
              key={m.id}
              className={`mb-2 max-w-[95%] ${m.role === 'user' ? 'self-end' : 'self-start'}`}
            >
              {(() => {
                const isBlockedState = m.role === 'assistant' && isNeedsNewBlockMessage(m.content);
                return (
              <View
                className={`rounded-xl px-2.5 py-2 ${
                  m.role === 'user'
                    ? 'bg-indigo-600/35 border border-indigo-500/40'
                    : isBlockedState
                      ? 'bg-amber-500/10 border border-amber-500/30'
                      : 'bg-[#1f1f1f] border border-[#333]'
                }`}
              >
                <Text className="text-gray-500 text-[10px] font-instrument-semibold uppercase mb-1">
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </Text>
                {isBlockedState ? (
                  <Text className="text-amber-200 text-[10px] font-instrument-semibold uppercase mb-1">
                    Missing block capability
                  </Text>
                ) : null}
                <Text className="text-gray-100 text-sm font-instrument leading-5">{m.content}</Text>
                {isBlockedState ? (
                  <Text className="text-amber-100/80 text-xs font-instrument leading-5 mt-2">
                    Flux is pausing here instead of inventing a fake block. Build the primitive, then
                    return to this campaign and continue the same thread.
                  </Text>
                ) : null}
              </View>
                );
              })()}
            </View>
          ))
        )}
        {sending ? (
          <View className="flex-row items-center gap-2 py-2">
            <ActivityIndicator size="small" color="#a5b4fc" />
            <Text className="text-gray-400 text-xs font-instrument">Thinking…</Text>
          </View>
        ) : null}
      </ScrollView>
      <View className="flex-row gap-2 items-end">
        <TextInput
          className="flex-1 text-white text-sm font-instrument bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl px-3 py-3 min-h-[48px] max-h-[120px]"
          placeholder={composerPlaceholder}
          placeholderTextColor="#666"
          value={draft}
          onChangeText={setDraft}
          multiline
          editable={!sending && chatConfigured}
          onSubmitEditing={() => { void submit(); }}
          blurOnSubmit={false}
        />
        <Button size="sm" onPress={() => { void submit(); }} disabled={sending || !draft.trim() || !chatConfigured}>
          Send
        </Button>
      </View>
      {footer ? <View className="mt-2">{footer}</View> : null}
      <View className="mt-1 items-center">
        <Button variant="link" size="xs" onPress={onUndo} disabled={!canUndo}>
          Undo last chat change
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}
