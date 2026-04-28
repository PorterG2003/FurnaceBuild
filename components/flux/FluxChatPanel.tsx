import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputKeyPressEventData,
} from 'react-native';
import { ArrowUpIcon, ArrowUturnLeftIcon, DocumentDuplicateIcon } from 'react-native-heroicons/outline';
import { IconButton } from '@/components/ui/icon-button';
import { Alert } from '@/components/ui/feedback';
import type { FluxChatMessage } from '@/lib/flux/editor/reducer';

const COMPOSER_MIN_HEIGHT = 40;
const COMPOSER_MAX_HEIGHT = 300;

function isNeedsNewBlockMessage(content: string): boolean {
  return /^needs new block:/i.test(content.trim());
}

interface FluxChatPanelProps {
  messages: FluxChatMessage[];
  lastSummary: string[] | null;
  showLastSummary?: boolean;
  sending: boolean;
  error: string | null;
  chatConfigured: boolean;
  rewindableMessageIds: string[];
  emptyStateText?: string;
  composerPlaceholder?: string;
  footer?: React.ReactNode;
  onSend: (text: string) => Promise<void>;
  onRewindMessage: (message: FluxChatMessage) => Promise<boolean>;
}

export function FluxChatPanel({
  messages,
  lastSummary,
  showLastSummary = false,
  sending,
  error,
  chatConfigured,
  rewindableMessageIds,
  emptyStateText = 'Start by describing the audience, the deliverable, and why the page should feel custom to each lead.',
  composerPlaceholder = 'Ask Flux to shape the campaign…',
  footer,
  onSend,
  onRewindMessage,
}: FluxChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);

  const submit = useCallback(async () => {
    const t = draft.trim();
    if (!t || sending) return;
    setDraft('');
    setComposerHeight(COMPOSER_MIN_HEIGHT);
    await onSend(t);
  }, [draft, sending, onSend]);

  const copyMessage = useCallback(async (text: string) => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(text);
  }, []);

  const editMessage = useCallback(
    async (message: FluxChatMessage) => {
      if (sending) return;
      const rewound = await onRewindMessage(message);
      if (rewound) {
        setDraft(message.content);
      }
    },
    [onRewindMessage, sending],
  );

  useEffect(() => {
    if (!draft) {
      setComposerHeight(COMPOSER_MIN_HEIGHT);
    }
  }, [draft]);

  const onComposerContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const h = e.nativeEvent.contentSize.height;
      if (!Number.isFinite(h) || h <= 0) return;
      setComposerHeight((prev) => {
        const next = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, h));
        return next === prev ? prev : next;
      });
    },
    [],
  );

  /**
   * react-native-web assigns its own `onKeyDown` to the textarea, so a custom `onKeyDown` prop is
   * dropped. `onKeyPress` is invoked from that handler first; we can `preventDefault()` there to
   * block the newline and send on Enter (Shift+Enter keeps the default newline).
   */
  const onComposerKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData> & { key?: string; shiftKey?: boolean }) => {
      if (Platform.OS !== 'web') return;
      const key = e.key ?? e.nativeEvent?.key;
      if (key !== 'Enter') return;
      const shiftKey = Boolean(
        e.shiftKey ?? (e.nativeEvent as { shiftKey?: boolean }).shiftKey,
      );
      if (shiftKey) return;
      const ne = e.nativeEvent as { isComposing?: boolean; keyCode?: number };
      if (ne.isComposing || ne.keyCode === 229) return;
      e.preventDefault();
      void submit();
    },
    [submit],
  );

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
          messages.map((m) => {
            const isUser = m.role === 'user';
            const isBlockedState = m.role === 'assistant' && isNeedsNewBlockMessage(m.content);
            const canRewind = isUser && rewindableMessageIds.includes(m.id);
            return (
              <View
                key={m.id}
                className={`mb-2 max-w-[95%] ${isUser ? 'self-end items-end' : 'self-start items-start'}`}
              >
                <View
                  className={`rounded-xl px-2.5 py-2 ${
                    isUser
                      ? 'bg-indigo-600/35 border border-indigo-500/40'
                      : isBlockedState
                        ? 'bg-amber-500/10 border border-amber-500/30'
                        : 'bg-[#1f1f1f] border border-[#333]'
                  }`}
                >
                  <Text className="text-gray-500 text-[10px] font-instrument-semibold uppercase mb-1">
                    {isUser ? 'You' : 'Assistant'}
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
                <View className={`mt-1 flex-row gap-1 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <IconButton
                    icon={DocumentDuplicateIcon}
                    variant="ghost"
                    size="xs"
                    className="rounded-full"
                    accessibilityLabel="Copy chat message"
                    onPress={() => {
                      void copyMessage(m.content);
                    }}
                  />
                  {canRewind ? (
                    <IconButton
                      icon={ArrowUturnLeftIcon}
                      variant="ghost"
                      size="xs"
                      className="rounded-full"
                      accessibilityLabel="Edit chat message"
                      onPress={() => {
                        void editMessage(m);
                      }}
                      disabled={sending}
                    />
                  ) : null}
                </View>
              </View>
            );
          })
        )}
        {sending ? (
          <View className="flex-row items-center gap-2 py-2">
            <ActivityIndicator size="small" color="#a5b4fc" />
            <Text className="text-gray-400 text-xs font-instrument">Thinking…</Text>
          </View>
        ) : null}
      </ScrollView>
      <View className="rounded-xl border border-[#2A2A2A] bg-[#1A1A1A] px-3 py-1.5">
        <View className="relative flex-1 min-w-0">
          <TextInput
            className="text-white text-sm font-instrument py-2 pr-11"
            style={{
              height: composerHeight,
              minHeight: COMPOSER_MIN_HEIGHT,
              maxHeight: COMPOSER_MAX_HEIGHT,
            }}
            placeholder={composerPlaceholder}
            placeholderTextColor="#666"
            value={draft}
            onChangeText={setDraft}
            onContentSizeChange={onComposerContentSizeChange}
            multiline
            scrollEnabled
            textAlignVertical="top"
            editable={!sending && chatConfigured}
            blurOnSubmit={false}
            {...(Platform.OS === 'web' ? { onKeyPress: onComposerKeyPress } : {})}
          />
          <IconButton
            icon={ArrowUpIcon}
            size="sm"
            variant="default"
            className="absolute bottom-1 right-0 h-8 w-8 rounded-full p-0"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => {
              void submit();
            }}
            disabled={sending || !draft.trim() || !chatConfigured}
          />
        </View>
      </View>
      {footer ? <View className="mt-2">{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}
