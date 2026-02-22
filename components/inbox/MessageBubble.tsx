import { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, ArrowPathIcon, ExclamationCircleIcon } from 'react-native-heroicons/outline';
import type { EmailMessage } from '@/lib/supabase/types';
import { getDisplayBody } from '@/lib/email/index';
import { formatMessageDate, getInitials } from '@/lib/inbox';
import { MessageBody } from './MessageBody';
import { MessageAttachments } from './MessageAttachments';

/** Single message bubble: centered card with avatar and Reply/Forward in header */
export function MessageBubble({
  message,
  onReply,
  onForward,
  onDownloadAttachment,
  onFetchAttachmentPreview,
  isPending,
  isFailed,
  errorMessage,
  onRetry,
}: {
  message: EmailMessage;
  onReply?: (message: EmailMessage) => void;
  onForward?: (message: EmailMessage) => void;
  onDownloadAttachment?: (emailMessageId: string, part: string, filename: string) => Promise<void>;
  onFetchAttachmentPreview?: (emailMessageId: string, part: string) => Promise<Blob | null>;
  isPending?: boolean;
  isFailed?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}) {
  const rawBody = message.body_text ?? message.body_html ?? '';
  const body = getDisplayBody(rawBody, {
    format: message.body_text ? 'text' : 'html',
  });
  const sender = message.from_name || message.from_email;
  const isSent = message.direction === 'sent';
  const canReply = onReply != null && !isPending && !isFailed;
  const canForward = onForward != null && !isPending && !isFailed;
  const showRetry = isFailed && onRetry != null;

  const borderPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isPending || isFailed) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(borderPulse, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: false,
        }),
        Animated.timing(borderPulse, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isPending, isFailed, borderPulse]);

  const animatedBorderColor = borderPulse.interpolate({
    inputRange: [0, 1],
    outputRange: ['#2A2A2A', 'rgba(243, 68, 13, 0.55)'],
  });

  const cardContent = (
    <View
      className="rounded-xl w-[92%] max-w-[92%] overflow-hidden"
      style={{
        backgroundColor: isSent ? '#1E1E1E' : '#1A1A1A',
        borderWidth: isPending || isFailed ? 0 : 1,
        borderColor: isPending || isFailed ? 'transparent' : '#2A2A2A',
      }}
    >
      {isPending && !isFailed ? (
        <Animated.View
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderWidth: 2,
            borderRadius: 12,
            borderColor: animatedBorderColor,
          }}
        />
      ) : null}
      {isFailed ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderWidth: 2,
            borderRadius: 12,
            borderColor: '#EF4444',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <View className="px-5 pt-4 pb-3">
        <View className="flex-row items-center justify-between flex-wrap gap-2">
          <View className="flex-row items-center flex-1 min-w-0">
            <View
              className="w-10 h-10 rounded-full items-center justify-center flex-shrink-0"
              style={{ backgroundColor: '#2A2A2A' }}
            >
              <Text className="text-white font-instrument-semibold text-sm">
                {getInitials(message.from_name, message.from_email)}
              </Text>
            </View>
            <View className="ml-3 items-start flex-1 min-w-0">
              <Text className="text-white font-instrument-semibold text-base" numberOfLines={1}>
                {isSent ? 'You' : sender}
              </Text>
              <Text className="text-gray-400 font-instrument text-xs mt-0.5" numberOfLines={1}>
                {message.from_email}
              </Text>
            </View>
            <Text className="text-gray-500 font-instrument text-xs flex-shrink-0 ml-2">
              {isFailed ? 'Failed' : isPending ? 'Sending…' : formatMessageDate(message.received_at)}
            </Text>
          </View>
          {showRetry && (
            <Pressable
              onPress={onRetry}
              className="flex-row items-center gap-2 rounded-lg px-3 py-2 flex-shrink-0"
              hitSlop={8}
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)' }}
            >
              <ArrowPathIcon size={16} color="#EF4444" />
              <Text className="font-instrument-medium text-sm" style={{ color: '#EF4444' }}>
                Retry
              </Text>
            </Pressable>
          )}
          {canReply && (
            <Pressable
              onPress={() => onReply(message)}
              className="flex-row items-center gap-2 rounded-lg px-3 py-2 flex-shrink-0"
              hitSlop={8}
              style={{ backgroundColor: 'rgba(243, 68, 13, 0.12)' }}
            >
              <ArrowUturnLeftIcon size={16} color="#F3440D" />
              <Text className="font-instrument-medium text-sm" style={{ color: '#F3440D' }}>
                Reply
              </Text>
            </Pressable>
          )}
          {canForward && (
            <Pressable
              onPress={() => onForward(message)}
              className="flex-row items-center gap-2 rounded-lg px-3 py-2 flex-shrink-0"
              hitSlop={8}
              style={{ backgroundColor: 'rgba(107, 114, 128, 0.2)' }}
            >
              <ArrowUturnRightIcon size={16} color="#9CA3AF" />
              <Text className="font-instrument-medium text-sm text-gray-400">
                Forward
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      <View className="mx-5 border-b border-[#2A2A2A]" style={{ borderBottomWidth: 1 }} />
      <View className="px-5 py-4">
        {isFailed && errorMessage ? (
          <View className="mb-3 flex-row items-start gap-2 rounded-lg p-3" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <ExclamationCircleIcon size={18} color="#EF4444" style={{ marginTop: 2 }} />
            <View className="flex-1">
              <Text className="text-red-400 font-instrument-semibold text-sm mb-1">Failed to send</Text>
              <Text className="text-red-300 font-instrument text-xs">{errorMessage}</Text>
            </View>
          </View>
        ) : null}
        <MessageBody
          bodyHtml={message.body_html}
          bodyText={message.body_text}
          displayText={body}
        />
        {onDownloadAttachment && (
          <MessageAttachments
            message={message}
            onDownload={onDownloadAttachment}
            onFetchPreview={onFetchAttachmentPreview}
          />
        )}
      </View>
    </View>
  );

  return (
    <View className="mb-4 flex-row justify-center items-center">
      {cardContent}
    </View>
  );
}
